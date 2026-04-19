/* ── FlowSchool — Home page ── */

async function initHome() {
  const ctx = await requireAuth('lenny');
  if (!ctx) return;
  const { sb, user } = ctx;

  // Header
  document.getElementById('header-greeting').textContent = 'Hey, Lenny! 👋';
  document.getElementById('header-avatar').addEventListener('click', logout);

  // Load stats + subjects
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
}

/* ─── Subjects ─── */
async function loadSubjects(sb, userId) {
  const { data: subjects } = await sb
    .from('subjects')
    .select('*')
    .or(`is_default.eq.true,created_by.eq.${userId}`)
    .order('sort_order');

  const { data: allProgress } = await sb
    .from('progress')
    .select('lesson_id, completed')
    .eq('user_id', userId);

  const { data: allLessons } = await sb
    .from('lessons')
    .select('id, subject_id');

  const progressBySubject = {};
  if (allLessons && allProgress) {
    allLessons.forEach(lesson => {
      if (!progressBySubject[lesson.subject_id]) {
        progressBySubject[lesson.subject_id] = { total: 0, done: 0 };
      }
      progressBySubject[lesson.subject_id].total++;
      const done = allProgress.find(p => p.lesson_id === lesson.id && p.completed);
      if (done) progressBySubject[lesson.subject_id].done++;
    });
  }

  const grid = document.getElementById('subject-grid');
  grid.innerHTML = '';

  (subjects || []).forEach((subject, i) => {
    const prog = progressBySubject[subject.id] || { total: 0, done: 0 };
    const pct  = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
    const isNew = prog.done === 0;

    const card = document.createElement('div');
    card.className = 'subject-card';
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="subject-card__bg" style="background:linear-gradient(135deg,${subject.color_from},${subject.color_to})"></div>
      <div class="subject-card__body">
        <span class="subject-card__emoji">${subject.emoji}</span>
        <div class="subject-card__name">${subject.name}</div>
        <div class="subject-card__meta">${prog.done}/${prog.total} Lektionen</div>
        <div class="subject-card__badges">
          ${isNew ? '<span class="badge badge-new">Neu</span>' : ''}
          ${pct === 100 ? '<span class="badge badge-done">✓ Fertig</span>' : ''}
        </div>
        <div class="progress-bar subject-card__progress">
          <div class="progress-bar__fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    card.addEventListener('click', () => showLessons(sb, userId, subject));
    grid.appendChild(card);
  });

  // Add-subject card
  const addCard = document.createElement('div');
  addCard.className = 'add-subject-card';
  addCard.innerHTML = `<div class="add-subject-card__icon">＋</div><div>Eigenes Thema</div>`;
  addCard.addEventListener('click', () => openAddSubjectModal(sb, userId));
  grid.appendChild(addCard);
}

/* ─── Lesson list ─── */
async function showLessons(sb, userId, subject) {
  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-lessons').classList.add('active');

  document.getElementById('subject-emoji').textContent   = subject.emoji;
  document.getElementById('subject-name').textContent    = subject.name;
  document.getElementById('subject-desc').textContent    = subject.description || '';

  const { data: lessons } = await sb
    .from('lessons')
    .select('*')
    .eq('subject_id', subject.id)
    .order('sort_order');

  const { data: progress } = await sb
    .from('progress')
    .select('lesson_id, completed, score')
    .eq('user_id', userId);

  const progressMap = {};
  (progress || []).forEach(p => { progressMap[p.lesson_id] = p; });

  const list = document.getElementById('lesson-list');
  list.innerHTML = '';

  (lessons || []).forEach((lesson, i) => {
    const prog = progressMap[lesson.id];
    const done = prog?.completed || false;

    const item = document.createElement('div');
    item.className = `lesson-item${done ? ' completed' : ''}`;
    item.style.animationDelay = `${i * 0.05}s`;
    item.innerHTML = `
      <div class="lesson-item__number">${done ? '✓' : i + 1}</div>
      <div class="lesson-item__title">${lesson.title}</div>
      <div class="lesson-item__meta">${lesson.duration_minutes} Min${done ? ' · ✓' : ''}</div>
    `;
    item.addEventListener('click', () => {
      const params = new URLSearchParams({
        lessonId:    lesson.id,
        subjectId:   subject.id,
        subjectName: subject.name,
        title:       lesson.title
      });
      window.location.href = `/lesson?${params}`;
    });
    list.appendChild(item);
  });
}

document.getElementById('back-to-home').addEventListener('click', () => {
  document.getElementById('view-lessons').classList.remove('active');
  document.getElementById('view-home').classList.add('active');
});

/* ─── Add subject modal ─── */
function openAddSubjectModal(sb, userId) {
  document.getElementById('modal-add-subject').classList.remove('hidden');
}
document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-add-subject').classList.add('hidden');
});
document.getElementById('modal-save').addEventListener('click', async () => {
  const name  = document.getElementById('new-subject-name').value.trim();
  const emoji = document.getElementById('new-subject-emoji').value.trim() || '📚';
  const desc  = document.getElementById('new-subject-desc').value.trim();
  if (!name) return;

  const ctx = await requireAuth('lenny');
  const { sb, user } = ctx;

  const colors = [
    ['#7c6aff','#ff6a9e'],['#ff6a9e','#ffcc6a'],['#6affcc','#7c6aff'],['#ffcc6a','#6affcc']
  ];
  const [from, to] = colors[Math.floor(Math.random() * colors.length)];

  const { error } = await sb.from('subjects').insert({
    name, emoji, description: desc,
    color_from: from, color_to: to,
    created_by: user.id, is_default: false, sort_order: 99
  });

  if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

  document.getElementById('modal-add-subject').classList.add('hidden');
  document.getElementById('new-subject-name').value  = '';
  document.getElementById('new-subject-emoji').value = '';
  document.getElementById('new-subject-desc').value  = '';
  showToast('Thema hinzugefügt! 🎉', 'success');
  await loadSubjects(sb, user.id);
});
