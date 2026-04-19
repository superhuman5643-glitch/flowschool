export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { searchTerm, isBreak = false } = req.body;
  if (!searchTerm) return res.status(400).json({ error: 'Missing searchTerm' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YouTube API key not configured' });

  try {
    const safeSearch = isBreak ? 'strict' : 'moderate';
    const params = new URLSearchParams({
      part:            'snippet',
      q:               searchTerm,
      type:            'video',
      maxResults:      '5',
      safeSearch,
      relevanceLanguage: 'de',
      key:             apiKey
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data     = await response.json();

    if (data.error) {
      console.error('YouTube API error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }

    // Pick first suitable video (prefer longer videos for lessons, shorter for breaks)
    const items = data.items || [];
    if (items.length === 0) return res.json({ videoId: null });

    const videoId = items[0]?.id?.videoId || null;
    res.json({ videoId });

  } catch (err) {
    console.error('youtube-search error:', err);
    res.status(500).json({ error: err.message });
  }
}
