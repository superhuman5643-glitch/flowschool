import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, interests, strongTopics, weakTopics, learningStyle, businessDream, goal } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const notes = [
    businessDream && `Business-Traum: ${businessDream}`,
    goal         && `Ziel: ${goal}`,
    learningStyle && `Lernstil: ${learningStyle}`,
  ].filter(Boolean).join(' | ');

  try {
    await sb.from('child_profiles').upsert({
      user_id:            userId,
      interests:          interests || [],
      strong_topics:      strongTopics ? [strongTopics] : [],
      weak_topics:        weakTopics  ? [weakTopics]  : [],
      preferred_examples: interests || [],
      learning_notes:     notes,
      vocab_level:        1,
    }, { onConflict: 'user_id' });

    res.json({ ok: true });
  } catch (err) {
    console.error('save-onboarding error:', err);
    res.status(500).json({ error: err.message });
  }
}
