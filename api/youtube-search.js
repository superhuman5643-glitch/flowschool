import { createClient as createSb } from '@supabase/supabase-js';

async function getVideoSettings() {
  try {
    const sb = createSb(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb.from('app_settings').select('key, value');
    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });
    return {
      preferred_channels: map.preferred_channels || '',
      max_age_years:      map.max_age_years      || '5',
      video_duration:     map.video_duration     || 'medium',
      language:           map.language           || 'de',
    };
  } catch {
    return { preferred_channels: '', max_age_years: '5', video_duration: 'medium', language: 'de' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { searchTerm, isBreak = false } = req.body;
  if (!searchTerm) return res.status(400).json({ error: 'Missing searchTerm' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YouTube API key not configured' });

  try {
    const settings = isBreak ? null : await getVideoSettings();

    // Build search query — append preferred channel names as keywords
    let query = searchTerm;
    if (settings?.preferred_channels) {
      const channels = settings.preferred_channels.split(',').map(c => c.trim()).filter(Boolean);
      if (channels.length > 0) query += ' ' + channels.slice(0, 3).join(' OR ');
    }

    // publishedAfter based on max age
    let publishedAfter = undefined;
    const maxAge = parseInt(settings?.max_age_years || '0', 10);
    if (maxAge > 0) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - maxAge);
      publishedAfter = d.toISOString();
    }

    // Duration filter
    const durationMap = { short: 'short', medium: 'medium', long: 'long' };
    const videoDuration = durationMap[settings?.video_duration] || undefined;

    const lang = isBreak ? 'de' : (settings?.language || 'de');

    const params = new URLSearchParams({
      part:              'snippet',
      q:                 query,
      type:              'video',
      maxResults:        isBreak ? '5' : '10',
      safeSearch:        isBreak ? 'strict' : 'strict',
      relevanceLanguage: lang,
      key:               apiKey,
      ...(publishedAfter && { publishedAfter }),
      ...(videoDuration  && !isBreak && { videoDuration }),
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data     = await response.json();

    if (data.error) {
      console.error('YouTube API error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }

    const items = data.items || [];
    if (items.length === 0) return res.json({ videoId: null });

    let best;
    if (isBreak) {
      // Pick a random video from the results so every break feels different
      best = items[Math.floor(Math.random() * items.length)];
    } else if (settings?.preferred_channels) {
      // If preferred channels set, score results: preferred channel = +10 bonus
      best = items[0];
      const preferred = settings.preferred_channels.toLowerCase().split(',').map(c => c.trim());
      let bestScore = -1;
      for (const item of items) {
        const channel = (item.snippet?.channelTitle || '').toLowerCase();
        const score = preferred.some(p => channel.includes(p)) ? 10 : 0;
        if (score > bestScore) { bestScore = score; best = item; }
      }
    } else {
      best = items[0];
    }

    res.json({ videoId: best?.id?.videoId || null });

  } catch (err) {
    console.error('youtube-search error:', err);
    res.status(500).json({ error: err.message });
  }
}
