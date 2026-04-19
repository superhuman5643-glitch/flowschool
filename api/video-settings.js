import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DEFAULTS = {
  preferred_channels: '',       // comma-separated channel names/handles
  max_age_years: '5',           // max video age in years (0 = no limit)
  video_duration: 'medium',     // 'any' | 'short' | 'medium' | 'long'
  language: 'de',
};

async function getVideoSettings() {
  try {
    const { data } = await sb.from('app_settings').select('key, value');
    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });
    return { ...DEFAULTS, ...map };
  } catch {
    return DEFAULTS;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const settings = await getVideoSettings();
    return res.json(settings);
  }

  if (req.method === 'POST') {
    const { preferred_channels, max_age_years, video_duration, language } = req.body;
    const entries = [
      { key: 'preferred_channels', value: preferred_channels ?? DEFAULTS.preferred_channels },
      { key: 'max_age_years',      value: String(max_age_years ?? DEFAULTS.max_age_years) },
      { key: 'video_duration',     value: video_duration ?? DEFAULTS.video_duration },
      { key: 'language',           value: language ?? DEFAULTS.language },
    ];
    try {
      await sb.from('app_settings').upsert(entries, { onConflict: 'key' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
}
