import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const STICKER_MAP = {
  'Emotionale Intelligenz':       ['💛','🧡','❤️','💜','🌈'],
  'Finanzielle Intelligenz':      ['💰','💎','👑','🏆','🌟'],
  'KI verstehen & beherrschen':   ['🤖','🧠','⚡','🚀','✨'],
  'Bau dein eigenes Business':    ['🌱','🛒','💡','📈','🏆'],
};
const DEFAULT_STICKERS = ['⭐','🌟','💫','🎯','🏅'];

function getStickerEmoji(subjectName, level) {
  const list = STICKER_MAP[subjectName] || DEFAULT_STICKERS;
  return list[(level - 1) % list.length];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, subjectId, subjectName, completedLevel } = req.body;
  if (!userId || !subjectId || !subjectName || completedLevel == null) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const MAX_LEVELS = 5;
  const nextLevel = completedLevel + 1;
  const stickerEmoji = getStickerEmoji(subjectName, completedLevel);
  const subjectComplete = completedLevel === MAX_LEVELS;

  // Award sticker (ignore conflict = already awarded)
  if (completedLevel > 0) {
    await sb.from('level_stickers').upsert({
      user_id: userId,
      subject_id: subjectId,
      level: completedLevel,
      sticker_emoji: stickerEmoji
    }, { onConflict: 'user_id,subject_id,level', ignoreDuplicates: true });
  }

  // Award XP bonus for level completion
  if (completedLevel > 0) {
    const xpBonus = subjectComplete ? 1000 : 100;
    try {
      await sb.from('xp_bonus_log').insert({
        user_id: userId,
        source: subjectComplete ? 'subject_complete' : 'level_complete',
        source_id: subjectId,
        xp: xpBonus
      });
    } catch {}
  }

  // Subject complete — no more lessons to generate
  if (subjectComplete) {
    return res.json({ sticker: stickerEmoji, nextLevel, subjectComplete: true });
  }

  // Always ensure challenge exists for completed level
  if (completedLevel > 0) {
    const { data: existingChallenge } = await sb
      .from('challenges').select('id')
      .eq('subject_id', subjectId).eq('level', completedLevel).maybeSingle();

    if (!existingChallenge) {
      try {
        const challengeMsg = await client.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 256,
          system: 'Du erstellst praktische Alltagsaufgaben für einen 12-jährigen. Antworte NUR mit validem JSON: {"title": "Kurzer Titel (max 8 Wörter)", "description": "Konkrete Aufgabe die zeigt dass das Gelernte angewendet wird (2-3 Sätze, alltagsnah und machbar)"}',
          messages: [{ role: 'user', content: `Fach: "${subjectName}", Level ${completedLevel} abgeschlossen. Erstelle eine praktische Alltagsaufgabe. Auf Deutsch.` }]
        });
        const cRaw = challengeMsg.content[0].text.trim();
        const { title: cTitle, description: cDesc } = JSON.parse(cRaw.replace(/^```json\s*/, '').replace(/```\s*$/, ''));
        await sb.from('challenges').insert({ subject_id: subjectId, level: completedLevel, title: cTitle, description: cDesc, bonus_xp: 250 });
      } catch (cErr) { console.error('challenge gen error:', cErr); }
    }
  }

  // Check if next-level lessons already exist for this subject
  const { data: existing } = await sb
    .from('lessons')
    .select('id')
    .eq('subject_id', subjectId)
    .gte('sort_order', (completedLevel * 5) + 1)
    .limit(1);

  if (existing?.length > 0) {
    return res.json({ sticker: stickerEmoji, nextLevel, alreadyExists: true });
  }

  // Generate 5 new lesson titles for the next level
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: 'Du erstellst Lektionstitel für einen 12-jährigen. Antworte NUR mit validem JSON: {"titles": ["Titel 1", "Titel 2", "Titel 3", "Titel 4", "Titel 5"]}',
      messages: [{
        role: 'user',
        content: `Fach: "${subjectName}". Level ${nextLevel} (Grundlagen bekannt, jetzt tiefer gehen).
Erstelle 5 fortgeschrittenere Lektionstitel die auf Level ${completedLevel} aufbauen. Auf Deutsch.`
      }]
    });

    const raw = msg.content[0].text.trim();
    const { titles } = JSON.parse(raw.replace(/^```json\s*/, '').replace(/```\s*$/, ''));

    const lessons = titles.map((title, i) => ({
      subject_id: subjectId,
      title,
      sort_order: completedLevel * 5 + i + 1,
      duration_minutes: 10
    }));

    await sb.from('lessons').insert(lessons);

    res.json({ sticker: stickerEmoji, nextLevel });
  } catch (err) {
    console.error('level-up error:', err);
    res.status(500).json({ error: err.message });
  }
}
