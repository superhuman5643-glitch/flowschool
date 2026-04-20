import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { submissionId, action = 'approve', reason } = req.body;
  if (!submissionId) return res.status(400).json({ error: 'Missing submissionId' });

  try {
    if (action === 'reject') {
      await sb.from('challenge_submissions').update({
        status: 'rejected',
        reject_reason: reason || null,
        reviewed_at: new Date().toISOString()
      }).eq('id', submissionId);

      return res.json({ success: true });
    }

    // action === 'approve' (default)
    const { data: sub } = await sb
      .from('challenge_submissions')
      .select('user_id, challenges(bonus_xp)')
      .eq('id', submissionId)
      .single();

    if (!sub) return res.status(404).json({ error: 'Not found' });

    const bonusXp = sub.challenges?.bonus_xp || 250;

    await sb.from('challenge_submissions').update({
      status: 'approved',
      xp_awarded: bonusXp,
      reviewed_at: new Date().toISOString()
    }).eq('id', submissionId);

    await sb.from('xp_bonus_log').insert({
      user_id: sub.user_id,
      source: 'challenge',
      source_id: submissionId,
      xp: bonusXp
    });

    res.json({ success: true, xp: bonusXp });
  } catch (err) {
    console.error('approve-challenge error:', err);
    res.status(500).json({ error: err.message });
  }
}
