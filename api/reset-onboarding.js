import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  // Find user
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const user = list?.users?.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Clear interests so onboarding shows again
  await sb.from('child_profiles')
    .update({ interests: [], learning_notes: '', strong_topics: [], weak_topics: [], preferred_examples: [] })
    .eq('user_id', user.id);

  res.json({ ok: true, userId: user.id });
}
