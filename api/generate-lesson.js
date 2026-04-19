import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { subjectName, lessonTitle } = req.body;
  if (!subjectName || !lessonTitle) return res.status(400).json({ error: 'Missing fields' });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `Du bist ein begeisterter Lehrerkollege für einen 12-jährigen Schüler namens Lenny.
Dein Ton: locker, freundlich, wie ein cooler älterer Freund — keine trockene Schulsprache.
Erkläre alles auf Deutsch mit vielen Alltagsbeispielen aus Lennys Welt (Gaming, Sport, YouTube, Freunde).
Nutze HTML-Tags für Formatierung: <h2>, <p>, <ul><li>, <strong>, <em>.
Nutze diese speziellen Klassen für Highlights:
- <div class="highlight">wichtige Erkenntnis</div>
- <div class="example">💡 Beispiel: ...</div>
- <div class="fun-fact">🤯 Wusstest du: ...</div>

Antworte NUR mit validem JSON in exakt diesem Format:
{
  "content": "<h2>...</h2><p>...</p>...",
  "quizQuestions": ["Frage 1?", "Frage 2?", "Frage 3?"],
  "videoSearchTerm": "YouTube Suchbegriff auf Deutsch"
}`,
      messages: [{
        role: 'user',
        content: `Erstelle eine Lektion zum Thema "${lessonTitle}" aus dem Fach "${subjectName}".
Länge: ca. 350-500 Wörter. 2-3 Abschnitte mit Überschriften.
Quiz: 2-3 offene Kurzfragen (kein Multiple Choice), die echtes Verständnis prüfen.
Video-Suchbegriff: passender YouTube-Begriff auf Deutsch für ein erklärendes Video.`
      }]
    });

    const raw  = message.content[0].text.trim();
    const json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/```\s*$/,''));
    res.json(json);

  } catch (err) {
    console.error('generate-lesson error:', err);
    res.status(500).json({ error: err.message });
  }
}
