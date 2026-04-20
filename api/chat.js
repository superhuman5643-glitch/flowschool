import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { lessonContent, lessonTitle, question, history = [], userName = 'du', learningNotes = '' } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });

  try {
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: question }
    ];

    const profileHint = learningNotes ? `\nLernprofil: ${learningNotes.slice(0, 300)}` : '';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: `Du hilfst ${userName} beim Verstehen seiner aktuellen Schullektion.
Aktuelle Lektion: "${lessonTitle}"
Lektionsinhalt (Kontext):
${lessonContent?.slice(0, 2000) || ''}${profileHint}

Antworte auf Deutsch, locker und freundlich — kurz und klar (2-4 Sätze max).
Wenn ${userName} etwas nicht versteht, erkläre es anders mit einem neuen Beispiel aus seinem Alltag.
Keine langen Essays — sei präzise wie ein guter Freund der erklärt.`,
      messages
    });

    res.json({ answer: response.content[0].text });

  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: err.message });
  }
}
