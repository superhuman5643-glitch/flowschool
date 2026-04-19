import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Delete existing broken testuser
  const { data: existing } = await sb.from('users')
    .select('id').eq('email', 'testuser@flowschool.app').single();

  if (existing) {
    await sb.auth.admin.deleteUser(existing.id);
  }

  // Create properly via admin API
  const { data, error } = await sb.auth.admin.createUser({
    email: 'testuser@flowschool.app',
    password: 'Test123!',
    email_confirm: true
  });

  if (error) return res.status(500).json({ error: error.message });

  // Add to public.users
  await sb.from('users').upsert({
    id: data.user.id,
    email: 'testuser@flowschool.app',
    role: 'lenny'
  }, { onConflict: 'id' });

  res.json({ ok: true, id: data.user.id });
}
