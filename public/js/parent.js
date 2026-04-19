/* ── FlowSchool — Parent dashboard ── */

let parentCtx = null;
let activeDays = 7;

async function initParent() {
  parentCtx = await requireAuth('parent');
  if (!parentCtx) return;

  document.getElementById('header-avatar').addEventListener('click', logout);

  // Date filter
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDays = parseInt(btn.dataset.days, 10);
      loadDashboard();
    });
  });

  await Promise.all([loadDashboard(), loadVideoSettings()]);
  setupVideoSettingsSave();
  hideLoader();
}

async function loadDashboard() {
  const { sb } = parentCtx;

  // Find Lenny's user ID
  const { data: lenny } = await sb
    .from('users')
    .select('id')
    .eq('role', 'lenny')
    .limit(1)
    .single();

  if (!lenny) {
    showEmptyState();
    return;
  }

  const lennyId  = lenny.id;
  const since    = activeDays > 0
    ? new Date(Date.now() - activeDays * 86400000).toISOString()
    : new Date(0).toISOString();

  await Promise.all([
    loadSummaryStats(sb, lennyId, since),
    loadActivities(sb, lennyId, since),
    loadQuestions(sb, lennyId, since),
    loadSubjectProgress(sb, lennyId),
    loadStreak(sb, lennyId),
    loadChallengeReviews(sb, lennyId),
    loadSurpriseAlert(sb, lennyId)
  ]);
}

/* ─── Summary stats ─── */
async function loadSummaryStats(sb, lennyId, since) {
  const [progressRes, sessionRes] = await Promise.all([
    sb.from('progress')
      .select('lesson_id, completed, time_spent_seconds, completed_at')
      .eq('user_id', lennyId)
      .gte('completed_at', since),
    sb.from('sessions')
      .select('breaks_taken, active_minutes, start_time')
      .eq('user_id', lennyId)
      .gte('start_time', since)
  ]);

  const progress  = progressRes.data || [];
  const sessions  = sessionRes.data  || [];

  const lessons   = progress.filter(p => p.completed).length;
  const totalSecs = progress.reduce((s, p) => s + (p.time_spent_seconds || 0), 0);
  const hours     = (totalSecs / 3600).toFixed(1);
  const breaks    = sessions.reduce((s, s2) => s + (s2.breaks_taken || 0), 0);
  const xp        = lessons * 100;

  document.getElementById('stat-lessons').textContent  = lessons;
  document.getElementById('stat-time').textContent     = hours;
  document.getElementById('stat-xp').textContent       = xp;
  document.getElementById('stat-breaks').textContent   = breaks;
}

/* ─── Activity feed ─── */
async function loadActivities(sb, lennyId, since) {
  const { data: progress } = await sb
    .from('progress')
    .select('lesson_id, completed, completed_at, lessons(title, subjects(name, emoji))')
    .eq('user_id', lennyId)
    .eq('completed', true)
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(10);

  const list = document.getElementById('activity-list');
  if (!progress || progress.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state__emoji">📚</div>Noch keine Aktivitäten in diesem Zeitraum</div>';
    return;
  }

  list.innerHTML = '';
  progress.forEach(p => {
    const lesson   = p.lessons;
    const subject  = lesson?.subjects;
    const when     = p.completed_at ? formatRelative(new Date(p.completed_at)) : '';

    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <div class="activity-item__dot activity-item__dot--green"></div>
      <div class="activity-item__content">
        <div class="activity-item__title">
          ${subject?.emoji || '📚'} ${lesson?.title || 'Lektion abgeschlossen'}
        </div>
        <div class="activity-item__sub">${subject?.name || ''}</div>
      </div>
      <div class="activity-item__time">${when}</div>
    `;
    list.appendChild(item);
  });
}

/* ─── Questions ─── */
async function loadQuestions(sb, lennyId, since) {
  const { data: chats } = await sb
    .from('chat_messages')
    .select('question, created_at, lessons(title)')
    .eq('user_id', lennyId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(15);

  const container = document.getElementById('questions-list');
  if (!chats || chats.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__emoji">💬</div>Keine Fragen in diesem Zeitraum</div>';
    return;
  }

  container.innerHTML = '';
  chats.forEach(c => {
    const div = document.createElement('div');
    div.className = 'question-item';
    div.innerHTML = `
      <div class="question-item__q">${c.question}</div>
      <div class="question-item__meta">${c.lessons?.title || ''} · ${formatRelative(new Date(c.created_at))}</div>
    `;
    container.appendChild(div);
  });
}

/* ─── Subject progress ─── */
async function loadSubjectProgress(sb, lennyId) {
  const { data: subjects } = await sb.from('subjects').select('id, name, emoji').eq('is_default', true).order('sort_order');
  const { data: lessons }  = await sb.from('lessons').select('id, subject_id');
  const { data: progress } = await sb.from('progress').select('lesson_id, completed').eq('user_id', lennyId).eq('completed', true);

  const doneSet = new Set((progress || []).map(p => p.lesson_id));

  const container = document.getElementById('subject-progress-list');
  container.innerHTML = '';

  (subjects || []).forEach(subject => {
    const subjectLessons = (lessons || []).filter(l => l.subject_id === subject.id);
    const total = subjectLessons.length;
    const done  = subjectLessons.filter(l => doneSet.has(l.id)).length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

    const item = document.createElement('div');
    item.className = 'subject-progress-item';
    item.innerHTML = `
      <div class="subject-progress-item__header">
        <span class="subject-progress-item__name">${subject.emoji} ${subject.name}</span>
        <span class="subject-progress-item__pct">${done}/${total} · ${pct}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" style="width:${pct}%"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

/* ─── Streak calendar ─── */
async function loadStreak(sb, lennyId) {
  const { data: sessions } = await sb
    .from('sessions')
    .select('start_time')
    .eq('user_id', lennyId);

  const activeDates = new Set(
    (sessions || []).map(s => s.start_time?.split('T')[0]).filter(Boolean)
  );

  const grid = document.getElementById('streak-grid');
  grid.innerHTML = '';

  const today = new Date();
  let streak  = 0;
  let counting = true;

  for (let i = 27; i >= 0; i--) {
    const d    = new Date(today);
    d.setDate(d.getDate() - i);
    const key  = d.toISOString().split('T')[0];
    const isToday = i === 0;
    const active  = activeDates.has(key);

    if (counting) {
      if (active || isToday) { if (active) streak++; }
      else { counting = false; }
    }

    const cell = document.createElement('div');
    cell.className = `streak-day${active ? ' active' : ''}${isToday ? ' today' : ''}`;
    cell.title = key;
    grid.appendChild(cell);
  }

  document.getElementById('streak-count').textContent = streak;
}

/* ─── Surprise alert ─── */
async function loadSurpriseAlert(sb, lennyId) {
  const [statsRes, bonusRes, usedRes] = await Promise.all([
    sb.from('user_stats').select('xp_points').eq('user_id', lennyId).single(),
    sb.from('xp_bonus_log').select('xp').eq('user_id', lennyId),
    sb.from('xp_milestones').select('milestone_xp').eq('user_id', lennyId)
  ]);
  const xp      = (statsRes.data?.xp_points || 0) + (bonusRes.data || []).reduce((s, r) => s + r.xp, 0);
  const usedSet = new Set((usedRes.data || []).map(m => m.milestone_xp));
  const banner  = document.getElementById('surprise-banner');
  if (!banner) return;

  if (xp >= 10000 && usedSet.has(10000)) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="surprise-banner__emoji">👑</div>
      <div class="surprise-banner__body">
        <div class="surprise-banner__title">Lenny hat 10.000 XP erreicht!</div>
        <div class="surprise-banner__sub">Das ist eine unglaubliche Leistung — Lenny erwartet eine Mega-Überraschung von euch! 🎉</div>
      </div>`;
  } else if (xp >= 5000 && usedSet.has(5000)) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="surprise-banner__emoji">🎁</div>
      <div class="surprise-banner__body">
        <div class="surprise-banner__title">Lenny hat 5.000 XP erreicht!</div>
        <div class="surprise-banner__sub">Lenny wartet auf eine Überraschung von euch — ihr habt es versprochen! 🥳</div>
      </div>`;
  }
}

/* ─── Challenge reviews ─── */
async function loadChallengeReviews(sb, lennyId) {
  const { data: submissions } = await sb
    .from('challenge_submissions')
    .select('*, challenges(title, description, bonus_xp, subjects(name, emoji))')
    .eq('user_id', lennyId)
    .order('submitted_at', { ascending: false });

  const container = document.getElementById('challenges-review-list');
  const badge     = document.getElementById('challenges-badge');
  if (!submissions || submissions.length === 0) return;

  const pendingCount = submissions.filter(s => s.status === 'pending').length;
  if (pendingCount > 0) badge?.classList.remove('hidden');

  container.innerHTML = '';
  submissions.forEach(sub => {
    const ch      = sub.challenges || {};
    const subject = ch.subjects || {};
    const item    = document.createElement('div');
    item.className = 'challenge-review-item';

    const actionsHtml = sub.status === 'approved'
      ? `<div class="challenge-review-item__approved">✅ Bestätigt · +${sub.xp_awarded || 50} XP</div>`
      : `<div class="challenge-review-item__actions">
           <button class="btn btn-primary" style="font-size:.85rem;padding:8px 16px" data-id="${sub.id}">✅ Bestätigen (+250 XP)</button>
         </div>`;

    item.innerHTML = `
      <div class="challenge-review-item__header">
        <span class="challenge-review-item__emoji">${subject.emoji || '🎯'}</span>
        <span class="challenge-review-item__title">${ch.title || 'Challenge'}</span>
      </div>
      <div class="challenge-review-item__meta">${subject.name || ''} · ${formatRelative(new Date(sub.submitted_at))}</div>
      ${sub.text_response ? `<div class="challenge-review-item__text">${sub.text_response}</div>` : ''}
      ${sub.photo_url ? `<img class="challenge-review-item__photo" src="${sub.photo_url}" alt="Foto" />` : ''}
      ${actionsHtml}
    `;

    if (sub.status !== 'approved') {
      item.querySelector('[data-id]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Wird bestätigt…';
        try {
          await fetch('/api/approve-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: sub.id })
          });
          showToast('Challenge bestätigt! Lenny bekommt +50 XP 🎉', 'success');
          await loadChallengeReviews(sb, lennyId);
        } catch {
          btn.disabled = false;
          btn.textContent = '✅ Bestätigen (+250 XP)';
          showToast('Fehler beim Bestätigen.', 'error');
        }
      });
    }

    container.appendChild(item);
  });
}

/* ─── Helpers ─── */
function formatRelative(date) {
  const diffMs   = Date.now() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 2)   return 'gerade eben';
  if (diffMins < 60)  return `vor ${diffMins} Min`;
  const diffH = Math.round(diffMins / 60);
  if (diffH < 24)     return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1)    return 'gestern';
  return `vor ${diffD} Tagen`;
}

function showEmptyState() {
  document.querySelectorAll('.summary-card__value').forEach(el => el.textContent = '—');
}

/* ─── Video Settings ─── */
async function loadVideoSettings() {
  try {
    const res  = await fetch('/api/video-settings');
    const data = await res.json();
    document.getElementById('vs-channels').value  = data.preferred_channels || '';
    document.getElementById('vs-max-age').value   = data.max_age_years || '3';
    document.getElementById('vs-duration').value  = data.video_duration || 'medium';
    document.getElementById('vs-language').value  = data.language || 'de';
  } catch {}
}

function setupVideoSettingsSave() {
  document.getElementById('vs-save').addEventListener('click', async () => {
    const btn    = document.getElementById('vs-save');
    const status = document.getElementById('vs-status');
    btn.disabled = true;
    btn.textContent = 'Speichern…';
    try {
      const res = await fetch('/api/video-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferred_channels: document.getElementById('vs-channels').value.trim(),
          max_age_years:      document.getElementById('vs-max-age').value,
          video_duration:     document.getElementById('vs-duration').value,
          language:           document.getElementById('vs-language').value,
        })
      });
      const data = await res.json();
      if (data.ok) {
        status.textContent = '✅ Gespeichert!';
        showToast('Video-Einstellungen gespeichert!', 'success');
      } else {
        status.textContent = '❌ Fehler: ' + (data.error || 'Tabelle fehlt — SQL unten ausführen');
        showToast('Fehler beim Speichern. Tabelle anlegen?', 'error');
      }
    } catch {
      status.textContent = '❌ Verbindungsfehler';
    }
    btn.disabled = false;
    btn.textContent = 'Einstellungen speichern';
    setTimeout(() => { status.textContent = ''; }, 4000);
  });
}
