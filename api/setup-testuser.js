import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // Hard-delete via SQL first (catches all edge cases)
  await sb.rpc('delete_test_user').catch(() => {});

  // Also try admin API delete
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find(u => u.email === 'testuser@flowschool.app');
  if (existing) {
    await sb.auth.admin.deleteUser(existing.id);
  }

  // Small delay to let deletion propagate
  await new Promise(r => setTimeout(r, 1000));

  // Create fresh
  const { data, error } = await sb.auth.admin.createUser({
    email: 'testuser@flowschool.app',
    password: 'Test123!',
    email_confirm: true,
    user_metadata: {}
  });

  if (error) return res.status(500).json({ error: error.message, step: 'create' });

  // Add to public.users
  const { error: e2 } = await sb.from('users').upsert({
    id: data.user.id,
    email: 'testuser@flowschool.app',
    role: 'lenny'
  }, { onConflict: 'id' });

  if (e2) return res.status(500).json({ error: e2.message, step: 'public_users' });

  res.json({ ok: true, id: data.user.id });
}
