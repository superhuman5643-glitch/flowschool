/* Returns public env vars to the frontend */
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Find Lenny's user ID using service role (bypasses RLS)
  let lennyId = '';
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const lenny = (data?.users || []).find(u => u.email === 'lenny@flowschool.app');
    lennyId = lenny?.id || '';
  } catch {}

  res.json({
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY  || '',
    lennyId
  });
}
