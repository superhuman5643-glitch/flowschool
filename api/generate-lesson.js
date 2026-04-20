import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { subjectName, lessonTitle, userId, lessonId, level = 1 } = req.body;
  if (!subjectName || !lessonTitle) return res.status(400).json({ error: 'Missing fields' });

  // Return cached content if available
  if (lessonId) {
    try {
      const { data: cached } = await sb
        .from('lessons')
        .select('content, quiz_questions, video_search_term, generated_at')
        .eq('id', lessonId)
        .single();

      // Only use cache if it was personalized for this user (name check)
      const cachedForThisUser = !cached?.content || childName === 'du' ||
        cached.content.toLowerCase().includes(childName.toLowerCase());
      if (cached?.generated_at && cached?.content && cachedForThisUser) {
        // Extract embedded mcQuestions from last element if present
        const allQ = cached.quiz_questions || [];
        const last = allQ[allQ.length - 1];
        let quizQuestions = allQ;
        let mcQuestions = [];
        if (typeof last === 'string' && last.startsWith('{"__mc__":')) {
          try { mcQuestions = JSON.parse(last).__mc__ || []; } catch {}
          quizQuestions = allQ.slice(0, -1);
        }
        return res.json({
          content: cached.content,
          quizQuestions,
          mcQuestions,
          videoSearchTerm: cached.video_search_term || ''
        });
      }
    } catch {}
  }

  // Fetch child's name dynamically
  let childName = 'du';
  if (userId) {
    try {
      const { data: { user } } = await sb.auth.admin.getUserById(userId);
      childName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'du';
    } catch {}
  }

  // Build profile context
  let profileCtx = '';
  if (userId) {
    let profile = null;
    try {
      const { data } = await sb.from('child_profiles').select('*').eq('user_id', userId).single();
      profile = data;
    } catch {}

    if (profile) {
      const parts = [];
      if (profile.interests?.length)          parts.push(`Interessen: ${profile.interests.join(', ')}`);
      if (profile.preferred_examples?.length) parts.push(`Bevorzugte Beispiele: ${profile.preferred_examples.join(', ')}`);
      if (profile.strong_topics?.length)      parts.push(`Starke Themen: ${profile.strong_topics.join(', ')}`);
      if (profile.weak_topics?.length)        parts.push(`Schwache Themen (extra erklären): ${profile.weak_topics.join(', ')}`);
      if (profile.learning_notes)             parts.push(`Notizen: ${profile.learning_notes}`);
      const vocab = profile.vocab_level === 3 ? 'fortgeschritten' : profile.vocab_level === 2 ? 'mittel' : 'einfach';
      parts.push(`Vokabular-Level: ${vocab}`);
      if (parts.length) profileCtx = `\n\nLernprofil von ${childName}:\n${parts.join('\n')}`;
    }
  }

  const levelNote = level > 1
    ? `\nDies ist Level ${level} — der Schüler kennt die Grundlagen bereits. Gehe tiefer, nutze anspruchsvollere Konzepte und weniger Erklärungen für Basics.`
    : '';

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: `Du bist ein begeisterter Lehrerkollege für einen Schüler namens ${childName}.
Dein Standard-Ton: locker, freundlich, wie ein cooler älterer Freund — keine trockene Schulsprache.
Erkläre alles auf Deutsch mit vielen Alltagsbeispielen aus der Welt des Schülers (Gaming, Sport, YouTube, Freunde usw.).
Nutze HTML-Tags für Formatierung: <h2>, <p>, <ul><li>, <strong>, <em>.
Nutze diese speziellen Klassen für Highlights:
- <div class="highlight">wichtige Erkenntnis</div>
- <div class="example">💡 Beispiel: ...</div>
- <div class="fun-fact">🤯 Wusstest du: ...</div>
${profileCtx}${levelNote}

Wenn ein Lernprofil vorhanden ist: passe Beispiele, Analogien und Erklärungstiefe gezielt daran an.
Ansprache-Stil-Regeln (aus "Ansprache-Stil" im Profil): "Freund" = locker & persönlich (Standard). "Lehrer" = strukturierter, klare Abschnitte, etwas formeller. "Klar & kurz" = sehr knapp, direkt, wenig Fülltext, auf den Punkt.
Alter & Klasse beachten: Vokabular und Komplexität an Alter/Klasse anpassen falls angegeben.
Antworte NUR mit validem JSON in exakt diesem Format:
{
  "content": "<h2>...</h2><p>...</p>...",
  "quizQuestions": ["Offene Frage 1?", "Offene Frage 2?"],
  "mcQuestions": [
    {"question": "MC-Frage 1?", "options": ["A", "B", "C", "D"], "correct": 0},
    {"question": "MC-Frage 2?", "options": ["A", "B", "C", "D"], "correct": 2}
  ],
  "videoSearchTerm": "YouTube Suchbegriff auf Deutsch"
}`,
      messages: [{
        role: 'user',
        content: `Erstelle eine Lektion zum Thema "${lessonTitle}" aus dem Fach "${subjectName}".
Länge: ca. 350-500 Wörter. 2-3 Abschnitte mit Überschriften.
Quiz: 2 offene Kurzfragen (max. 20 Wörter je Frage) + 2 Multiple-Choice-Fragen mit je 4 Antwortoptionen (correct = Index 0-3 der richtigen Antwort).
Video-Suchbegriff: passender YouTube-Begriff auf Deutsch für ein erklärendes Video.`
      }]
    });

    const raw  = message.content[0].text.trim();
    const json = JSON.parse(raw.replace(/^```json\s*/, '').replace(/```\s*$/, ''));

    // Embed mcQuestions as last element of quiz_questions for storage (no extra column needed)
    const allQuestions = [
      ...(json.quizQuestions || []),
      JSON.stringify({ __mc__: json.mcQuestions || [] })
    ];

    // Cache in DB
    if (lessonId) {
      try {
        await sb.from('lessons').update({
          content: json.content,
          quiz_questions: allQuestions,
          video_search_term: json.videoSearchTerm,
          generated_at: new Date().toISOString()
        }).eq('id', lessonId);
      } catch {}
    }

    res.json(json);

  } catch (err) {
    console.error('generate-lesson error:', err);
    res.status(500).json({ error: err.message });
  }
}
