import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, challengeId, textResponse, photoUrl } = req.body;
  if (!userId || !challengeId) return res.status(400).json({ error: 'Missing fields' });

  try {
    await sb.from('challenge_submissions').upsert({
      user_id: userId,
      challenge_id: challengeId,
      text_response: textResponse || null,
      photo_url: photoUrl || null,
      status: 'pending',
      submitted_at: new Date().toISOString()
    }, { onConflict: 'user_id,challenge_id' });

    res.json({ success: true });
  } catch (err) {
    console.error('submit-challenge error:', err);
    res.status(500).json({ error: err.message });
  }
}
