import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body;

  // POST /api/onboarding { action: 'save', userId, interests, ... }
  if (action === 'save') {
    const { userId, interests, strongTopics, weakTopics, learningStyle, businessDream, goal } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const notes = [
      businessDream && `Business-Traum: ${businessDream}`,
      goal          && `Ziel: ${goal}`,
      learningStyle && `Lernstil: ${learningStyle}`,
    ].filter(Boolean).join(' | ');

    try {
      await sb.from('child_profiles').upsert({
        user_id:            userId,
        interests:          interests || [],
        strong_topics:      strongTopics ? [strongTopics] : [],
        weak_topics:        weakTopics  ? [weakTopics]   : [],
        preferred_examples: interests   || [],
        learning_notes:     notes,
        vocab_level:        1,
      }, { onConflict: 'user_id' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/onboarding { action: 'reset', email }
  if (action === 'reset') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const user = list?.users?.find(u => u.email === email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await sb.from('child_profiles')
      .update({ interests: [], learning_notes: '', strong_topics: [], weak_topics: [], preferred_examples: [] })
      .eq('user_id', user.id);

    return res.json({ ok: true, userId: user.id });
  }

  res.status(400).json({ error: 'Unknown action' });
}
