import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, type, data } = req.body;
  if (!userId || !type || !data) return res.status(400).json({ error: 'Missing fields' });

  // Fetch child's name dynamically
  let userName = 'du';
  try {
    const { data: { user } } = await sb.auth.admin.getUserById(userId);
    userName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'du';
  } catch {}

  try {
    const { data: profile } = await sb.from('child_profiles')
      .select('*').eq('user_id', userId).single();

    const existing = profile || {
      interests: [], weak_topics: [], strong_topics: [],
      preferred_examples: [], learning_notes: '', vocab_level: 1,
      lessons_completed: 0, avg_quiz_attempts: 1.0
    };

    let inputContext = '';
    if (type === 'quiz') {
      const { questions, answers, lessonTitle, subject, attempts } = data;
      inputContext = `Thema: "${lessonTitle}" (Fach: ${subject}), Versuch ${attempts}:
${questions.map((q, i) => `Frage: ${q}\n${userName}s Antwort: ${answers[i]}`).join('\n\n')}`;
    } else if (type === 'chat') {
      const { chatHistory, lessonTitle } = data;
      inputContext = `Chat aus Lektion "${lessonTitle}":
${chatHistory.map(m => `${m.role === 'user' ? userName : 'KI'}: ${m.content}`).join('\n')}`;
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `Du analysierst Lerninteraktionen eines Schülers namens ${userName} und pflegst sein Lernprofil.
Aktuelles Profil:
- Interessen: ${existing.interests.join(', ') || 'noch keine'}
- Schwache Themen: ${existing.weak_topics.join(', ') || 'noch keine'}
- Starke Themen: ${existing.strong_topics.join(', ') || 'noch keine'}
- Bevorzugte Beispiele: ${existing.preferred_examples.join(', ') || 'noch keine'}
- Notizen: ${existing.learning_notes || 'keine'}
- Vokabular-Level: ${existing.vocab_level}/3

Analysiere und antworte NUR mit validem JSON:
{
  "interests": ["max 8 Stichworte"],
  "weak_topics": ["max 10 Stichworte"],
  "strong_topics": ["max 10 Stichworte"],
  "preferred_examples": ["max 6 Kategorien wie Gaming, Sport, Musik, Alltag"],
  "learning_notes": "max 300 Zeichen — was fällt auf?",
  "vocab_level": 1
}

Regeln:
- Ergänze bestehende Listen, lösche nichts ohne klaren Grund
- preferred_examples: erkenne welche Analogien/Beispiele Lenny gut aufnimmt
- vocab_level 1=einfach 2=mittel 3=fortgeschritten — nur ändern wenn eindeutig
- Fehler in Antworten → weak_topics; gute Konzepte → strong_topics`,
      messages: [{ role: 'user', content: inputContext }]
    });

    const raw = response.content[0].text.trim();
    const updates = JSON.parse(raw.replace(/^```json\s*/, '').replace(/```\s*$/, ''));

    const isQuizPass = type === 'quiz' && data.passed;
    const newAttempts = type === 'quiz' ? data.attempts || 1 : null;
    const newAvg = newAttempts !== null
      ? +(existing.avg_quiz_attempts * 0.8 + newAttempts * 0.2).toFixed(2)
      : existing.avg_quiz_attempts;

    await sb.from('child_profiles').upsert({
      user_id:           userId,
      interests:         updates.interests         ?? existing.interests,
      weak_topics:       updates.weak_topics       ?? existing.weak_topics,
      strong_topics:     updates.strong_topics     ?? existing.strong_topics,
      preferred_examples: updates.preferred_examples ?? existing.preferred_examples,
      learning_notes:    updates.learning_notes    ?? existing.learning_notes,
      vocab_level:       updates.vocab_level       ?? existing.vocab_level,
      lessons_completed: isQuizPass ? existing.lessons_completed + 1 : existing.lessons_completed,
      avg_quiz_attempts: newAvg,
      updated_at:        new Date().toISOString()
    }, { onConflict: 'user_id' });

    res.json({ ok: true });
  } catch (err) {
    console.error('update-profile error:', err);
    res.status(500).json({ error: err.message });
  }
}
