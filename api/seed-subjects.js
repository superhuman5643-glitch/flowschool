import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CORE_SUBJECTS = [
  {
    name: 'Bau dein eigenes Business',
    emoji: '🏪',
    description: 'Von der Idee zum ersten Verdienst — baue Schritt für Schritt dein eigenes kleines Business auf.',
    color_from: '#ffcc6a',
    color_to: '#6affcc',
    is_mandatory: true,
    is_default: true,
    sort_order: 4,
    unlock_xp: 0
  }
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const results = [];
  for (const subject of CORE_SUBJECTS) {
    const { data: existing } = await sb.from('subjects').select('id').eq('name', subject.name).maybeSingle();
    if (existing) { results.push({ name: subject.name, status: 'exists' }); continue; }

    const { error } = await sb.from('subjects').insert(subject);
    results.push({ name: subject.name, status: error ? 'error' : 'created', error: error?.message });
  }

  res.json({ results });
}
