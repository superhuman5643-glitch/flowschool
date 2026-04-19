import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Find and delete any existing testuser in auth
  const { data: list } = await sb.auth.admin.listUsers();
  const existing = list?.users?.find(u => u.email === 'testuser@flowschool.app');
  if (existing) {
    await sb.auth.admin.deleteUser(existing.id);
    await sb.from('users').delete().eq('id', existing.id);
  }

  // Create fresh via admin API (handles bcrypt + identities correctly)
  const { data, error } = await sb.auth.admin.createUser({
    email: 'testuser@flowschool.app',
    password: 'Test123!',
    email_confirm: true
  });

  if (error) return res.status(500).json({ error: error.message });

  // Add to public.users as student
  const { error: e2 } = await sb.from('users').insert({
    id: data.user.id,
    email: 'testuser@flowschool.app',
    role: 'lenny'
  });

  if (e2) return res.status(500).json({ error: e2.message });

  res.json({ ok: true, id: data.user.id, email: data.user.email });
}
