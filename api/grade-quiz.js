import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { question, answer, lessonContent } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'Missing fields' });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `Du bewertest kurze Quiz-Antworten eines 12-jährigen Schülers (Lenny).
Sei fair und ermutigend — es geht ums Verstehen, nicht um perfekte Formulierungen.
Eine Antwort gilt als BESTANDEN wenn das Kernverständnis da ist, auch wenn Details fehlen.

Lektionsinhalt als Kontext:
${lessonContent?.slice(0, 1500) || ''}

Antworte NUR mit validem JSON:
{ "passed": true/false, "feedback": "kurze ermutigende Rückmeldung auf Deutsch (1-2 Sätze)" }

Bei bestanden: kurz loben + was gut war.
Bei nicht bestanden: genau sagen was fehlt + einen hilfreichen Hinweis geben (kein "falsch" ohne Erklärung).`,
      messages: [{
        role: 'user',
        content: `Frage: ${question}\nLennys Antwort: ${answer}`
      }]
    });

    const raw  = response.content[0].text.trim();
    const json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/```\s*$/,''));
    res.json(json);

  } catch (err) {
    console.error('grade-quiz error:', err);
    res.status(500).json({ passed: false, feedback: 'Bewertung fehlgeschlagen, bitte nochmal versuchen.' });
  }
}
