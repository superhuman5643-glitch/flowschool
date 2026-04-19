/* ── FlowSchool — Home page ── */

const STICKER_MAP = {
  'Emotionale Intelligenz':    ['💛','🧡','❤️','💜','🌈'],
  'Finanzielle Intelligenz':   ['💰','💎','👑','🏆','🌟'],
  'KI verstehen & beherrschen':['🤖','🧠','⚡','🚀','✨'],
};
const DEFAULT_STICKERS = ['⭐','🌟','💫','🎯','🏅'];

function stickerFor(subjectName, level) {
  const list = STICKER_MAP[subjectName] || DEFAULT_STICKERS;
  return list[(level - 1) % list.length];
}

async function initHome() {
  const ctx = await requireAuth('lenny');
  if (!ctx) return;
  const { sb, user } = ctx;

  document.getElementById('header-greeting').textContent = 'Hey, Lenny! 👋';
  document.getElementById('header-avatar').addEventListener('click', logout);

  await Promise.all([loadStats(sb, user.id), loadSubjects(sb, user.id)]);
  hideLoader();
}

/* ─── Stats ─── */
async function loadStats(sb, userId) {
  const { data } = await sb.from('user_stats').select('*').eq('user_id', userId).single();
  if (!data) return;
  document.getElementById('stat-days').textContent    = data.days_active || 0;
  document.getElementById('stat-hours').textContent   = (data.hours_learned || 0) + 'h';
  document.getElementById('stat-xp').textContent      = data.xp_points || 0;
  document.getElementById('stat-lessons').textContent = data.lessons_completed || 0;
  return data;
}

/* ─── Subjects ─── */
async function loadSubjects(sb, userId) {
  // Mandatory subjects
  const { data: mandatory } = await sb
    .from('subjects')
    .select('*')
    .eq('is_mandatory', true)
    .order('sort_order');

  // Unlocked optional subjects
  const { data: unlockedRows } = await sb
    .from('unlocked_subjects')
    .select('subject_id')
    .eq('user_id', userId);

  let optional = [];
  const unlockedIds = (unlockedRows || []).map(r => r.subject_id);
  if (unlockedIds.length > 0) {
    const { data } = await sb.from('subjects').select('*').in('id', unlockedIds).order('sort_order');
    optional = data || [];
  }

  const subjects = [...(mandatory || []), ...optional];

  // Progress data
  const { data: allProgress } = await sb
    .from('progress').select('lesson_id, completed').eq('user_id', userId);
  const { data: allLessons } = await sb
    .from('lessons').select('id, subject_id, sort_order');

  // Stickers already earned
  const { data: stickers } = await sb
    .from('level_stickers').select('subject_id, level, sticker_emoji').eq('user_id', userId);
  const stickersBySubject = {};
  (stickers || []).forEach(s => {
    if (!stickersBySubject[s.subject_id]) stickersBySubject[s.subject_id] = [];
    stickersBySubject[s.subject_id].push(s);
  });

  // Build progress map per subject
  const progressBySubject = {};
  if (allLessons && allProgress) {
    const completedIds = new Set((allProgress || []).filter(p => p.completed).map(p => p.lesson_id));
    allLessons.forEach(l => {
      if (!progressBySubject[l.subject_id]) progressBySubject[l.subject_id] = { total: 0, done: 0 };
      progressBySubject[l.subject_id].total++;
      if (completedIds.has(l.id)) progressBySubject[l.subject_id].done++;
    });
  }

  const grid = document.getElementById('subject-grid');
  grid.innerHTML = '';

  const levelUpQueue = [];

  subjects.forEach((subject, i) => {
    const prog = progressBySubject[subject.id] || { total: 0, done: 0 };
    const currentLevel = Math.floor(prog.done / 5) + 1;
    const doneInLevel  = prog.done % 5;
    const levelComplete = prog.total > 0 && doneInLevel === 0 && prog.done > 0;
    const completedLevel = levelComplete ? prog.done / 5 : 0;

    // Check if we need to award sticker + generate next level
    const earned = (stickersBySubject[subject.id] || []).map(s => s.level);
    if (levelComplete && completedLevel > 0 && !earned.includes(completedLevel)) {
      levelUpQueue.push({ subject, completedLevel, prog });
    }

    const displayLevel = levelComplete ? currentLevel - 1 : currentLevel;
    const displayDone  = levelComplete ? 5 : doneInLevel;
    const pct          = Math.round((displayDone / 5) * 100);

    const earnedStickers = (stickersBySubject[subject.id] || [])
      .sort((a, b) => a.level - b.level)
      .map(s => s.sticker_emoji).join('');

    const card = document.createElement('div');
    card.className = 'subject-card';
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="subject-card__bg" style="background:linear-gradient(135deg,${subject.color_from},${subject.color_to})"></div>
      <div class="subject-card__body">
        <span class="subject-card__emoji">${subject.emoji}</span>
        <div class="subject-card__name">${subject.name}</div>
        <div class="subject-card__meta">Level ${displayLevel} · ${displayDone}/5 Lektionen</div>
        ${earnedStickers ? `<div class="subject-card__stickers">${earnedStickers}</div>` : ''}
        <div class="progress-bar subject-card__progress">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    card.addEventListener('click', () => showLessons(sb, userId, subject));
    grid.appendChild(card);
  });

  // Process level-ups (award sticker + generate new lessons)
  for (const { subject, completedLevel } of levelUpQueue) {
    await handleLevelUp(sb, userId, subject, completedLevel);
  }

  // XP milestone check
  const { data: statsData } = await sb.from('user_stats').select('xp_points').eq('user_id', userId).single();
  const xp = statsData?.xp_points || 0;
  await checkXpMilestones(sb, userId, xp, subjects);
}

/* ─── Level up ─── */
async function handleLevelUp(sb, userId, subject, completedLevel) {
  const emoji = stickerFor(subject.name, completedLevel);
  showStickerCelebration(emoji, subject.name, completedLevel);

  try {
    await fetch('/api/level-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId, subjectId: subject.id,
        subjectName: subject.name,
        completedLevel
      })
    });
  } catch {}
}

function showStickerCelebration(emoji, subjectName, level) {
  const banner = document.createElement('div');
  banner.className = 'sticker-celebration';
  banner.innerHTML = `
    <div class="sticker-celebration__inner">
      <div class="sticker-celebration__emoji">${emoji}</div>
      <div class="sticker-celebration__title">Level ${level} geschafft!</div>
      <div class="sticker-celebration__sub">${subjectName} · Sticker verdient!</div>
      <button class="btn btn-primary" onclick="this.closest('.sticker-celebration').remove()">Weiter 🚀</button>
    </div>
  `;
  document.body.appendChild(banner);
}

/* ─── XP Milestones ─── */
async function checkXpMilestones(sb, userId, xp, currentSubjects) {
  const { data: used } = await sb.from('xp_milestones').select('milestone_xp').eq('user_id', userId);
  const usedSet = new Set((used || []).map(m => m.milestone_xp));

  if (xp >= 500 && !usedSet.has(500)) {
    showXpBonus500(sb, userId, currentSubjects);
  } else if (xp >= 2000 && !usedSet.has(2000)) {
    showXpBonus2000(sb, userId);
  }
}

async function showXpBonus500(sb, userId, currentSubjects) {
  // Load unlockable subjects (unlock_xp = 500, not yet unlocked)
  const { data: available } = await sb
    .from('subjects')
    .select('*')
    .eq('unlock_xp', 500)
    .eq('is_mandatory', false)
    .order('sort_order');

  const currentIds = new Set(currentSubjects.map(s => s.id));
  const choices = (available || []).filter(s => !currentIds.has(s.id));
  if (choices.length === 0) return;

  const banner = document.getElementById('xp-bonus-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="xp-bonus__header">
      <span class="xp-bonus__badge">⚡ 500 XP</span>
      <h3 class="xp-bonus__title">Bonus freigeschaltet!</h3>
      <p class="xp-bonus__sub">Du hast 500 XP gesammelt — wähle ein neues Thema:</p>
    </div>
    <div class="xp-bonus__choices">
      ${choices.map(s => `
        <button class="xp-choice-btn" data-id="${s.id}">
          <span class="xp-choice-btn__emoji">${s.emoji}</span>
          <span class="xp-choice-btn__name">${s.name}</span>
        </button>
      `).join('')}
    </div>
  `;

  banner.querySelectorAll('.xp-choice-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const subjectId = btn.dataset.id;
      await sb.from('unlocked_subjects').insert({ user_id: userId, subject_id: subjectId }).catch(() => {});
      await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: 500 }).catch(() => {});
      banner.classList.add('hidden');
      showToast('Neues Thema freigeschaltet! 🎉', 'success');
      const ctx = await requireAuth('lenny');
      await loadSubjects(ctx.sb, ctx.user.id);
    });
  });
}

async function showXpBonus2000(sb, userId) {
  const banner = document.getElementById('xp-bonus-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="xp-bonus__header">
      <span class="xp-bonus__badge">⚡ 2000 XP</span>
      <h3 class="xp-bonus__title">Eigenes Thema!</h3>
      <p class="xp-bonus__sub">Du hast 2000 XP — erstelle dein eigenes Lernthema:</p>
    </div>
    <div class="xp-bonus__form">
      <input class="input" id="custom-topic-name" placeholder="Thema-Name (z.B. Astronomie)" maxlength="40" />
      <input class="input" id="custom-topic-emoji" placeholder="Emoji" maxlength="4" style="width:80px" />
      <button class="btn btn-primary" id="custom-topic-save">Erstellen 🚀</button>
    </div>
  `;

  document.getElementById('custom-topic-save').addEventListener('click', async () => {
    const name  = document.getElementById('custom-topic-name').value.trim();
    const emoji = document.getElementById('custom-topic-emoji').value.trim() || '📚';
    if (!name) return;

    const colors = [['#7c6aff','#ff6a9e'],['#ff6a9e','#ffcc6a'],['#6affcc','#7c6aff'],['#ffcc6a','#6affcc']];
    const [from, to] = colors[Math.floor(Math.random() * colors.length)];

    const { data: newSub, error } = await sb.from('subjects').insert({
      name, emoji, color_from: from, color_to: to,
      created_by: userId, is_default: false, is_mandatory: false,
      unlock_xp: 0, sort_order: 99
    }).select().single();

    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

    await sb.from('unlocked_subjects').insert({ user_id: userId, subject_id: newSub.id }).catch(() => {});
    await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: 2000 }).catch(() => {});
    banner.classList.add('hidden');
    showToast('Eigenes Thema erstellt! 🎉', 'success');
    const ctx = await requireAuth('lenny');
    await loadSubjects(ctx.sb, ctx.user.id);
  });
}

/* ─── Lesson list ─── */
async function showLessons(sb, userId, subject) {
  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-lessons').classList.add('active');

  document.getElementById('subject-emoji').textContent = subject.emoji;
  document.getElementById('subject-name').textContent  = subject.name;
  document.getElementById('subject-desc').textContent  = subject.description || '';

  const { data: lessons } = await sb
    .from('lessons').select('*').eq('subject_id', subject.id).order('sort_order');

  const { data: progress } = await sb
    .from('progress').select('lesson_id, completed, score').eq('user_id', userId);

  const progressMap = {};
  (progress || []).forEach(p => { progressMap[p.lesson_id] = p; });

  const list = document.getElementById('lesson-list');
  list.innerHTML = '';

  // Group by level (5 per level)
  const grouped = {};
  (lessons || []).forEach(lesson => {
    const lvl = Math.ceil(lesson.sort_order / 5);
    if (!grouped[lvl]) grouped[lvl] = [];
    grouped[lvl].push(lesson);
  });

  Object.entries(grouped).forEach(([lvl, lvlLessons]) => {
    const levelHeader = document.createElement('div');
    levelHeader.className = 'lesson-level-header';
    levelHeader.textContent = `Level ${lvl}`;
    list.appendChild(levelHeader);

    lvlLessons.forEach((lesson, i) => {
      const prog = progressMap[lesson.id];
      const done = prog?.completed || false;

      const item = document.createElement('div');
      item.className = `lesson-item${done ? ' completed' : ''}`;
      item.style.animationDelay = `${i * 0.05}s`;
      item.innerHTML = `
        <div class="lesson-item__number">${done ? '✓' : ((parseInt(lvl) - 1) * 5 + i + 1)}</div>
        <div class="lesson-item__title">${lesson.title}</div>
        <div class="lesson-item__meta">${lesson.duration_minutes} Min${done ? ' · ✓' : ''}</div>
      `;
      item.addEventListener('click', () => {
        const params = new URLSearchParams({
          lessonId: lesson.id, subjectId: subject.id,
          subjectName: subject.name, title: lesson.title
        });
        window.location.href = `/lesson?${params}`;
      });
      list.appendChild(item);
    });
  });
}

document.getElementById('back-to-home').addEventListener('click', () => {
  document.getElementById('view-lessons').classList.remove('active');
  document.getElementById('view-home').classList.add('active');
});
