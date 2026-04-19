/* ── FlowSchool — Home page ── */

const STICKER_MAP = {
  'Emotionale Intelligenz':       ['💛','🧡','❤️','💜','🌈'],
  'Finanzielle Intelligenz':      ['💰','💎','👑','🏆','🌟'],
  'KI verstehen & beherrschen':   ['🤖','🧠','⚡','🚀','✨'],
  'Bau dein eigenes Business':    ['🌱','🛒','💡','📈','🏆'],
};
const DEFAULT_STICKERS = ['⭐','🌟','💫','🎯','🏅'];

function stickerFor(subjectName, level) {
  const list = STICKER_MAP[subjectName] || DEFAULT_STICKERS;
  return list[(level - 1) % list.length];
}

/* ─── Ensure 4th core subject exists ─── */
async function ensureBusinessSubject(sb) {
  const { data } = await sb.from('subjects').select('id')
    .eq('name', 'Bau dein eigenes Business').maybeSingle();
  if (data) return;
  await sb.from('subjects').insert({
    name: 'Bau dein eigenes Business',
    emoji: '🏪',
    description: 'Von der Idee zum ersten Verdienst — baue Schritt für Schritt dein eigenes kleines Business auf.',
    color_from: '#ffcc6a',
    color_to: '#6affcc',
    is_mandatory: true,
    is_default: true,
    sort_order: 4,
    unlock_xp: 0
  });
}

async function initHome() {
  const ctx = await requireAuth('lenny');
  if (!ctx) return;
  const { sb, user } = ctx;

  const displayName = (user.email || '').split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim();
  const name = displayName.charAt(0).toUpperCase() + displayName.slice(1);
  document.getElementById('header-greeting').textContent = `Hey, ${name}! 👋`;
  document.getElementById('header-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('header-avatar').addEventListener('click', logout);

  await Promise.all([loadStats(sb, user.id), loadSubjects(sb, user.id), loadBadges(sb, user.id), loadChallenges(sb, user.id), loadXpRoadmap(sb, user.id)]);
  hideLoader();
}

/* ─── Stats ─── */
async function loadStats(sb, userId) {
  const [statsRes, bonusRes] = await Promise.all([
    sb.from('user_stats').select('*').eq('user_id', userId).single(),
    sb.from('xp_bonus_log').select('xp').eq('user_id', userId)
  ]);
  const data = statsRes.data;
  if (!data) return;
  const bonusXp = (bonusRes.data || []).reduce((s, r) => s + (r.xp || 0), 0);
  const totalXp = (data.xp_points || 0) + bonusXp;
  document.getElementById('stat-days').textContent    = data.days_active || 0;
  document.getElementById('stat-hours').textContent   = (data.hours_learned || 0) + 'h';
  document.getElementById('stat-xp').textContent      = totalXp;
  document.getElementById('stat-lessons').textContent = data.lessons_completed || 0;
  return { ...data, xp_points: totalXp };
}

/* ─── Subjects ─── */
async function loadSubjects(sb, userId) {
  await ensureBusinessSubject(sb);

  // Fetch subjects
  const { data: mandatory } = await sb.from('subjects').select('*').eq('is_mandatory', true).order('sort_order');
  const { data: unlockedRows } = await sb.from('unlocked_subjects').select('subject_id').eq('user_id', userId);
  const unlockedIds = (unlockedRows || []).map(r => r.subject_id);
  let optional = [];
  if (unlockedIds.length > 0) {
    const { data } = await sb.from('subjects').select('*').in('id', unlockedIds).order('sort_order');
    optional = data || [];
  }

  // Progress + lessons
  const { data: allProgress } = await sb.from('progress').select('lesson_id, completed, completed_at').eq('user_id', userId);
  const { data: allLessons }  = await sb.from('lessons').select('id, subject_id, sort_order');

  // Stickers
  const { data: stickers } = await sb.from('level_stickers').select('subject_id, level, sticker_emoji').eq('user_id', userId);
  const stickersBySubject = {};
  (stickers || []).forEach(s => {
    if (!stickersBySubject[s.subject_id]) stickersBySubject[s.subject_id] = [];
    stickersBySubject[s.subject_id].push(s);
  });

  // Progress map per subject
  const completedIds = new Set((allProgress || []).filter(p => p.completed).map(p => p.lesson_id));
  const progressBySubject = {};
  (allLessons || []).forEach(l => {
    if (!progressBySubject[l.subject_id]) progressBySubject[l.subject_id] = { total: 0, done: 0 };
    progressBySubject[l.subject_id].total++;
    if (completedIds.has(l.id)) progressBySubject[l.subject_id].done++;
  });

  // ── Daily gate ──
  const todayISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const mandatorySubjectIds = new Set((mandatory || []).map(s => s.id));
  const mandatoryLessonIds  = new Set((allLessons || []).filter(l => mandatorySubjectIds.has(l.subject_id)).map(l => l.id));
  const optionalLessonIds   = new Set((allLessons || []).filter(l => !mandatorySubjectIds.has(l.subject_id)).map(l => l.id));

  const todayDone = new Set(
    (allProgress || []).filter(p => p.completed && p.completed_at >= todayISO).map(p => p.lesson_id)
  );
  const coreDoneToday = [...todayDone].filter(id => mandatoryLessonIds.has(id)).length;
  const extraSubjectsDoneToday = new Set(
    (allLessons || []).filter(l => optionalLessonIds.has(l.id) && todayDone.has(l.id)).map(l => l.subject_id)
  );
  let slotsRemaining = coreDoneToday - extraSubjectsDoneToday.size;

  // ── Render Kernfächer ──
  const kernGrid = document.getElementById('kernfaecher-grid');
  kernGrid.innerHTML = '';
  const levelUpQueue = [];

  (mandatory || []).forEach((subject, i) => {
    const card = buildSubjectCard(subject, i, progressBySubject, stickersBySubject, levelUpQueue, sb, userId, false);
    kernGrid.appendChild(card);
  });

  // ── Render Extras ──
  const extrasSection = document.getElementById('extras-section');
  const extrasGrid    = document.getElementById('extras-grid');
  const gateLabel     = document.getElementById('extras-gate-label');
  const gateNotice    = document.getElementById('extras-gate-notice');

  if (optional.length > 0) {
    extrasSection.classList.remove('hidden');
    extrasGrid.innerHTML = '';

    if (coreDoneToday === 0) {
      gateLabel.textContent = '🔒 heute gesperrt';
      gateNotice.classList.remove('hidden');
    } else {
      gateLabel.textContent = `${extraSubjectsDoneToday.size}/${coreDoneToday} heute genutzt`;
      gateNotice.classList.add('hidden');
    }

    optional.forEach((subject, i) => {
      const doneToday = extraSubjectsDoneToday.has(subject.id);
      let locked = false;
      if (!doneToday) {
        if (coreDoneToday === 0 || slotsRemaining <= 0) {
          locked = true;
        } else {
          slotsRemaining--;
        }
      }
      const card = buildSubjectCard(subject, i, progressBySubject, stickersBySubject, levelUpQueue, sb, userId, locked);
      extrasGrid.appendChild(card);
    });
  }

  // Level-ups
  for (const { subject, completedLevel } of levelUpQueue) {
    await handleLevelUp(sb, userId, subject, completedLevel);
  }

  // XP milestone check
  const [statsRes2, bonusRes2] = await Promise.all([
    sb.from('user_stats').select('xp_points').eq('user_id', userId).single(),
    sb.from('xp_bonus_log').select('xp').eq('user_id', userId)
  ]);
  const baseXp   = statsRes2.data?.xp_points || 0;
  const bonusXp2 = (bonusRes2.data || []).reduce((s, r) => s + (r.xp || 0), 0);
  await checkXpMilestones(sb, userId, baseXp + bonusXp2, [...(mandatory || []), ...optional]);
}

function buildSubjectCard(subject, i, progressBySubject, stickersBySubject, levelUpQueue, sb, userId, locked) {
  const prog = progressBySubject[subject.id] || { total: 0, done: 0 };
  const currentLevel  = Math.floor(prog.done / 5) + 1;
  const doneInLevel   = prog.done % 5;
  const levelComplete = prog.total > 0 && doneInLevel === 0 && prog.done > 0;
  const completedLevel = levelComplete ? prog.done / 5 : 0;

  const earned = (stickersBySubject[subject.id] || []).map(s => s.level);
  if (levelComplete && completedLevel > 0 && !earned.includes(completedLevel)) {
    levelUpQueue.push({ subject, completedLevel, prog });
  }

  const displayLevel = levelComplete ? currentLevel - 1 : currentLevel;
  const displayDone  = levelComplete ? 5 : doneInLevel;
  const pct          = Math.round((displayDone / 5) * 100);
  const earnedStickers = (stickersBySubject[subject.id] || [])
    .sort((a, b) => a.level - b.level).map(s => s.sticker_emoji).join('');
  const hasNewLevel = levelComplete && prog.total > prog.done;

  const card = document.createElement('div');
  card.className = `subject-card${locked ? ' subject-card--locked' : ''}`;
  card.style.animationDelay = `${i * 0.06}s`;
  card.innerHTML = `
    ${hasNewLevel ? `<div class="subject-card__new-level">🔓 Level ${levelComplete ? currentLevel : 0} neu!</div>` : ''}
    ${locked ? '<div class="subject-card__lock">🔒</div>' : ''}
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

  if (locked) {
    card.addEventListener('click', () => showToast('Mach erst eine Kernfach-Lektion — dann wird dieser Extra freigeschaltet! 💪', 'error'));
  } else {
    card.addEventListener('click', () => showLessons(sb, userId, subject));
  }
  return card;
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

/* ─── XP Roadmap ─── */
async function loadXpRoadmap(sb, userId) {
  const [statsRes, bonusRes, usedRes] = await Promise.all([
    sb.from('user_stats').select('xp_points').eq('user_id', userId).single(),
    sb.from('xp_bonus_log').select('xp').eq('user_id', userId),
    sb.from('xp_milestones').select('milestone_xp').eq('user_id', userId)
  ]);

  const baseXp  = statsRes.data?.xp_points || 0;
  const bonus   = (bonusRes.data || []).reduce((s, r) => s + (r.xp || 0), 0);
  const xp      = baseXp + bonus;
  const usedSet = new Set((usedRes.data || []).map(m => m.milestone_xp));

  const milestones = [
    { xp: 0,     icon: '🚀', label: 'Start' },
    { xp: 500,   icon: '📚', label: '500 XP\nNeues Thema' },
    { xp: 2500,  icon: '✨', label: '2.500 XP\nEigenes Thema' },
    { xp: 5000,  icon: '🎁', label: '5.000 XP\nÜberraschung!' },
    { xp: 7500,  icon: '🌟', label: '7.500 XP\nNoch ein Thema' },
    { xp: 10000, icon: '👑', label: '10.000 XP\nMega-Überraschung' },
  ];

  const roadmap = document.getElementById('xp-roadmap');
  const counter = document.getElementById('xp-roadmap-current');
  if (!roadmap) return;

  counter.textContent = `${xp.toLocaleString('de')} XP`;

  const nextMilestone = milestones.find(m => m.xp > xp);
  roadmap.innerHTML = '';

  milestones.forEach((m, i) => {
    const isDone = xp >= m.xp;
    const isNext = nextMilestone && m.xp === nextMilestone.xp;

    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = `xp-roadmap-connector${isDone ? ' xp-roadmap-connector--done' : ''}`;
      roadmap.appendChild(conn);
    }

    const item = document.createElement('div');
    item.className = `xp-roadmap-item${isDone ? ' xp-roadmap-item--done' : ''}${isNext ? ' xp-roadmap-item--next' : ''}`;
    item.innerHTML = `
      <div class="xp-roadmap-item__node">${isDone && m.xp > 0 ? '✓' : m.icon}</div>
      <div class="xp-roadmap-item__label">${m.label.replace('\n', '<br>')}</div>
    `;
    roadmap.appendChild(item);
  });

  // Progress bar to next milestone
  if (nextMilestone) {
    const prevMs  = milestones[milestones.indexOf(nextMilestone) - 1];
    const range   = nextMilestone.xp - prevMs.xp;
    const prog    = xp - prevMs.xp;
    const pct     = Math.min(100, Math.round((prog / range) * 100));
    const missing = nextMilestone.xp - xp;

    const bar = document.createElement('div');
    bar.className = 'xp-roadmap-progress';
    bar.innerHTML = `
      <div class="xp-roadmap-progress__bar">
        <div class="progress-bar">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="xp-roadmap-progress__label">Noch ${missing.toLocaleString('de')} XP bis ${nextMilestone.icon}</div>
    `;
    roadmap.insertAdjacentElement('afterend', bar);
  }
}

/* ─── XP Milestones ─── */
const XP_MILESTONES = [
  { xp: 500,   type: 'unlock_subject',  label: '500 XP',   title: 'Neues Thema frei!',        sub: 'Du hast 500 XP — wähle ein neues Thema:' },
  { xp: 2500,  type: 'custom_subject',  label: '2.500 XP', title: 'Eigenes Thema!',            sub: 'Du hast 2.500 XP — erstelle dein eigenes Lernthema:' },
  { xp: 5000,  type: 'surprise',        label: '5.000 XP', title: '🎁 Überraschung!',          sub: 'Du hast 5.000 XP erreicht! Die Eltern haben eine Überraschung für dich!' },
  { xp: 7500,  type: 'custom_subject',  label: '7.500 XP', title: 'Noch ein eigenes Thema!',   sub: 'Du hast 7.500 XP — erstelle ein weiteres eigenes Lernthema:' },
  { xp: 10000, type: 'surprise',        label: '10.000 XP',title: '👑 Mega-Überraschung!',     sub: 'Du hast 10.000 XP! Das ist unglaublich — die Eltern haben etwas Besonderes für dich!' },
];

async function checkXpMilestones(sb, userId, xp, currentSubjects) {
  const { data: used } = await sb.from('xp_milestones').select('milestone_xp').eq('user_id', userId);
  const usedSet = new Set((used || []).map(m => m.milestone_xp));

  for (const milestone of XP_MILESTONES) {
    if (xp >= milestone.xp && !usedSet.has(milestone.xp)) {
      if (milestone.type === 'unlock_subject') {
        await showMilestoneUnlockSubject(sb, userId, milestone, currentSubjects);
      } else if (milestone.type === 'custom_subject') {
        showMilestoneCustomSubject(sb, userId, milestone);
      } else if (milestone.type === 'surprise') {
        await showMilestoneSurprise(sb, userId, milestone);
      }
      break; // show one at a time
    }
  }
}

async function showMilestoneUnlockSubject(sb, userId, milestone, currentSubjects) {
  const { data: available } = await sb.from('subjects').select('*').eq('unlock_xp', 500).eq('is_mandatory', false).order('sort_order');
  const currentIds = new Set(currentSubjects.map(s => s.id));
  const choices = (available || []).filter(s => !currentIds.has(s.id));
  if (choices.length === 0) {
    try { await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: milestone.xp }); } catch {}
    return;
  }
  const banner = document.getElementById('xp-bonus-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="xp-bonus__header">
      <span class="xp-bonus__badge">⚡ ${milestone.label}</span>
      <h3 class="xp-bonus__title">${milestone.title}</h3>
      <p class="xp-bonus__sub">${milestone.sub}</p>
    </div>
    <div class="xp-bonus__choices">
      ${choices.map(s => `<button class="xp-choice-btn" data-id="${s.id}"><span class="xp-choice-btn__emoji">${s.emoji}</span><span class="xp-choice-btn__name">${s.name}</span></button>`).join('')}
    </div>`;
  banner.querySelectorAll('.xp-choice-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await sb.from('unlocked_subjects').insert({ user_id: userId, subject_id: btn.dataset.id }); } catch {}
      try { await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: milestone.xp }); } catch {}
      banner.classList.add('hidden');
      showToast('Neues Thema freigeschaltet! 🎉', 'success');
      const ctx = await requireAuth('lenny');
      await loadSubjects(ctx.sb, ctx.user.id);
    });
  });
}

function showMilestoneCustomSubject(sb, userId, milestone) {
  const banner = document.getElementById('xp-bonus-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="xp-bonus__header">
      <span class="xp-bonus__badge">⚡ ${milestone.label}</span>
      <h3 class="xp-bonus__title">${milestone.title}</h3>
      <p class="xp-bonus__sub">${milestone.sub}</p>
    </div>
    <div class="xp-bonus__form">
      <input class="input" id="custom-topic-name" placeholder="Thema-Name (z.B. Astronomie)" maxlength="40" />
      <input class="input" id="custom-topic-emoji" placeholder="Emoji" maxlength="4" style="width:80px" />
      <button class="btn btn-primary" id="custom-topic-save">Erstellen 🚀</button>
    </div>`;
  document.getElementById('custom-topic-save').addEventListener('click', async () => {
    const name  = document.getElementById('custom-topic-name').value.trim();
    const emoji = document.getElementById('custom-topic-emoji').value.trim() || '📚';
    if (!name) return;
    const colors = [['#7c6aff','#ff6a9e'],['#ff6a9e','#ffcc6a'],['#6affcc','#7c6aff'],['#ffcc6a','#6affcc']];
    const [from, to] = colors[Math.floor(Math.random() * colors.length)];
    const { data: newSub, error } = await sb.from('subjects').insert({
      name, emoji, color_from: from, color_to: to,
      created_by: userId, is_default: false, is_mandatory: false, unlock_xp: 0, sort_order: 99
    }).select().single();
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    try { await sb.from('unlocked_subjects').insert({ user_id: userId, subject_id: newSub.id }); } catch {}
    try { await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: milestone.xp }); } catch {}
    try {
      await fetch('/api/level-up', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subjectId: newSub.id, subjectName: name, completedLevel: 0 }) });
    } catch {}
    banner.classList.add('hidden');
    showToast('Eigenes Thema erstellt! 🎉', 'success');
    const ctx = await requireAuth('lenny');
    await loadSubjects(ctx.sb, ctx.user.id);
  });
}

async function showMilestoneSurprise(sb, userId, milestone) {
  try { await sb.from('xp_milestones').insert({ user_id: userId, milestone_xp: milestone.xp }); } catch {}
  const overlay = document.createElement('div');
  overlay.className = 'sticker-celebration';
  overlay.innerHTML = `
    <div class="sticker-celebration__inner">
      <div class="sticker-celebration__emoji" style="font-size:5rem">${milestone.xp >= 10000 ? '👑' : '🎁'}</div>
      <div class="sticker-celebration__title">${milestone.title}</div>
      <div class="sticker-celebration__sub" style="max-width:320px;margin:0 auto 24px">${milestone.sub}</div>
      <button class="btn btn-primary" onclick="this.closest('.sticker-celebration').remove()">Ich freue mich! 🚀</button>
    </div>`;
  document.body.appendChild(overlay);
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

  // Auto-generate lessons if none exist yet (e.g. newly created custom subject)
  if (!lessons || lessons.length === 0) {
    list.innerHTML = '<div class="lesson-level-header">Lektionen werden erstellt…</div>';
    try {
      await fetch('/api/level-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subjectId: subject.id, subjectName: subject.name, completedLevel: 0 })
      });
    } catch {}
    // Reload lessons after generation
    const { data: freshLessons } = await sb.from('lessons').select('*').eq('subject_id', subject.id).order('sort_order');
    if (freshLessons?.length) {
      list.innerHTML = '';
      freshLessons.forEach((lesson, i) => {
        const item = document.createElement('div');
        item.className = 'lesson-item';
        item.style.animationDelay = `${i * 0.05}s`;
        item.innerHTML = `
          <div class="lesson-item__number">${i + 1}</div>
          <div class="lesson-item__title">${lesson.title}</div>
          <div class="lesson-item__meta">${lesson.duration_minutes} Min</div>
        `;
        item.addEventListener('click', () => {
          const params = new URLSearchParams({ lessonId: lesson.id, subjectId: subject.id, subjectName: subject.name, title: lesson.title });
          window.location.href = `/lesson?${params}`;
        });
        list.appendChild(item);
      });
    } else {
      list.innerHTML = '<div class="lesson-level-header">Fehler beim Erstellen. Bitte nochmal versuchen.</div>';
    }
    return;
  }

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

/* ─── Challenges ─── */
async function loadChallenges(sb, userId) {
  // Find all levels the user has completed (has stickers for)
  const { data: stickers } = await sb
    .from('level_stickers')
    .select('subject_id, level, subjects(name, emoji)')
    .eq('user_id', userId);

  if (!stickers || stickers.length === 0) return;

  const subjectIds = [...new Set(stickers.map(s => s.subject_id))];
  const { data: challenges } = await sb
    .from('challenges')
    .select('*')
    .in('subject_id', subjectIds);

  if (!challenges || challenges.length === 0) return;

  // Only show challenges for levels the user has completed
  const completedKey = new Set(stickers.map(s => `${s.subject_id}_${s.level}`));
  const relevant = challenges.filter(c => completedKey.has(`${c.subject_id}_${c.level}`));
  if (relevant.length === 0) return;

  // Get submissions
  const { data: submissions } = await sb
    .from('challenge_submissions')
    .select('*')
    .eq('user_id', userId)
    .in('challenge_id', relevant.map(c => c.id));

  const subMap = {};
  (submissions || []).forEach(s => { subMap[s.challenge_id] = s; });

  // Build subject name lookup
  const nameMap = {};
  stickers.forEach(s => { if (s.subjects) nameMap[s.subject_id] = s.subjects; });

  const section = document.getElementById('challenges-section');
  const list    = document.getElementById('challenges-list');
  const counter = document.getElementById('challenges-count');

  const pending = relevant.filter(c => !subMap[c.id] || subMap[c.id].status === 'pending').length;
  counter.textContent = pending > 0 ? `${pending} offen` : 'alle erledigt ✓';
  section.classList.remove('hidden');
  list.innerHTML = '';

  relevant.forEach((challenge, i) => {
    const sub     = subMap[challenge.id];
    const subject = nameMap[challenge.subject_id] || {};
    const card    = document.createElement('div');
    card.className = 'challenge-card';
    card.style.animationDelay = `${i * 0.07}s`;

    let statusHtml = '';
    let formHtml   = '';

    if (sub?.status === 'approved') {
      statusHtml = `<div class="challenge-card__status challenge-card__status--approved">✅ Von den Eltern bestätigt! +${sub.xp_awarded || 50} XP verdient</div>`;
    } else if (sub?.status === 'pending') {
      statusHtml = `<div class="challenge-card__status challenge-card__status--pending">⏳ Eingereicht — wartet auf Bestätigung der Eltern</div>`;
    } else {
      formHtml = `
        <div class="challenge-form" id="cform-${challenge.id}">
          <textarea placeholder="Beschreibe kurz was du gemacht hast…" id="ctext-${challenge.id}"></textarea>
          <div class="challenge-form__photo">
            <label class="challenge-form__photo-label" for="cphoto-${challenge.id}">📷 Foto hinzufügen</label>
            <input type="file" id="cphoto-${challenge.id}" accept="image/*" style="display:none" />
            <span class="challenge-form__photo-name" id="cpname-${challenge.id}"></span>
          </div>
          <img class="challenge-photo-preview hidden" id="cpreview-${challenge.id}" />
          <div class="challenge-form__actions">
            <button class="btn btn-primary" id="csubmit-${challenge.id}">Einreichen 🚀</button>
          </div>
        </div>`;
    }

    card.innerHTML = `
      <div class="challenge-card__header">
        <div class="challenge-card__icon">${subject.emoji || '🎯'}</div>
        <div class="challenge-card__info">
          <div class="challenge-card__meta">${subject.name || ''} · Level ${challenge.level}</div>
          <div class="challenge-card__title">${challenge.title}</div>
          <div class="challenge-card__desc">${challenge.description}</div>
        </div>
      </div>
      ${statusHtml}
      ${formHtml}
    `;
    list.appendChild(card);

    // Wire up form events
    if (!sub) {
      const photoInput = card.querySelector(`#cphoto-${challenge.id}`);
      const photoName  = card.querySelector(`#cpname-${challenge.id}`);
      const preview    = card.querySelector(`#cpreview-${challenge.id}`);
      const submitBtn  = card.querySelector(`#csubmit-${challenge.id}`);

      photoInput?.addEventListener('change', () => {
        const file = photoInput.files[0];
        if (!file) return;
        photoName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = e => {
          preview.src = e.target.result;
          preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      });

      submitBtn?.addEventListener('click', async () => {
        const text = document.getElementById(`ctext-${challenge.id}`)?.value.trim();
        if (!text) { showToast('Bitte beschreibe was du gemacht hast.', 'error'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Wird hochgeladen…';

        let photoUrl = null;
        const file = photoInput?.files[0];
        if (file) {
          try {
            const path = `${userId}/${challenge.id}/${Date.now()}_${file.name}`;
            const { error: upErr } = await sb.storage.from('challenge-photos').upload(path, file);
            if (!upErr) {
              const { data: urlData } = sb.storage.from('challenge-photos').getPublicUrl(path);
              photoUrl = urlData.publicUrl;
            }
          } catch {}
        }

        try {
          await fetch('/api/submit-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, challengeId: challenge.id, textResponse: text, photoUrl })
          });
          showToast('Challenge eingereicht! Die Eltern werden es bestätigen. 🎉', 'success');
          await loadChallenges(sb, userId);
        } catch {
          showToast('Fehler beim Einreichen. Bitte nochmal.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Einreichen 🚀';
        }
      });
    }
  });
}

/* ─── Badge collection ─── */
async function loadBadges(sb, userId) {
  const { data: stickers } = await sb
    .from('level_stickers')
    .select('level, sticker_emoji, subject_id, subjects(name)')
    .eq('user_id', userId)
    .order('subject_id')
    .order('level');

  const section = document.getElementById('badges-section');
  const grid    = document.getElementById('badges-grid');
  const count   = document.getElementById('badge-count');
  if (!stickers || stickers.length === 0) return;

  section.classList.remove('hidden');
  count.textContent = `${stickers.length} verdient`;
  grid.innerHTML = '';

  stickers.forEach((s, i) => {
    const subjectName = s.subjects?.name || '';
    const card = document.createElement('div');
    card.className = 'badge-card';
    card.style.animationDelay = `${i * 0.05}s`;
    card.innerHTML = `
      <div class="badge-card__emoji">${s.sticker_emoji}</div>
      <div class="badge-card__level">Level ${s.level}</div>
      <div class="badge-card__subject">${subjectName}</div>
    `;
    grid.appendChild(card);
  });
}

document.getElementById('back-to-home').addEventListener('click', () => {
  document.getElementById('view-lessons').classList.remove('active');
  document.getElementById('view-home').classList.add('active');
});
