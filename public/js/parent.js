/* ── FlowSchool — Parent dashboard ── */

let parentCtx     = null;
let activeDays    = 7;
let activeChildId = null;
let activeChildName = 'Kind';
let linkedChildren  = [];

async function initParent() {
  parentCtx = await requireAuth('parent');
  if (!parentCtx) return;

  document.getElementById('header-avatar').addEventListener('click', logout);
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Date filter
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDays = parseInt(btn.dataset.days, 10);
      if (activeChildId) loadDashboard();
    });
  });

  // Link-child form toggle
  document.getElementById('link-child-btn').addEventListener('click', () => {
    const form = document.getElementById('link-child-form');
    form.style.display = form.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('link-child-submit').addEventListener('click', linkChild);

  await loadChildren();
  await loadVideoSettings();
  setupVideoSettingsSave();
  setupSubjectsManager();
  hideLoader();
}

/* ─── Load linked children ─── */
async function loadChildren() {
  const { user } = parentCtx;
  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-children', parentId: user.id })
    });
    const data = await res.json();
    linkedChildren = data.children || [];
  } catch { linkedChildren = []; }

  const selectorWrap = document.getElementById('child-selector-wrap');
  const selector     = document.getElementById('child-selector');

  if (linkedChildren.length === 0) {
    document.getElementById('child-title').textContent = 'Noch kein Kind verlinkt';
    showEmptyState();
    document.getElementById('link-child-form').style.display = '';
    return;
  }

  // Activate first child
  activeChildId   = linkedChildren[0].id;
  activeChildName = linkedChildren[0].displayName;
  updateChildTitle();

  // Show dropdown only if multiple children
  if (linkedChildren.length > 1) {
    selectorWrap.style.display = '';
    selector.innerHTML = linkedChildren.map(c =>
      `<option value="${c.id}">${c.displayName}</option>`
    ).join('');
    selector.addEventListener('change', () => {
      const child = linkedChildren.find(c => c.id === selector.value);
      if (child) {
        activeChildId   = child.id;
        activeChildName = child.displayName;
        updateChildTitle();
        loadDashboard();
        loadSubjectsForChild(activeChildId, activeChildName);
      }
    });
  }

  await loadDashboard();
  await loadSubjectsForChild(activeChildId, activeChildName);
}

function updateChildTitle() {
  const name = activeChildName;
  document.getElementById('child-title').textContent     = `${name}s Lernfortschritt`;
  document.getElementById('questions-title').textContent = `❓ ${name}s Fragen`;
}

/* ─── Link a child by email ─── */
async function linkChild() {
  const emailEl    = document.getElementById('link-child-email');
  const nicknameEl = document.getElementById('link-child-nickname');
  const btn        = document.getElementById('link-child-submit');
  const status     = document.getElementById('link-child-status');

  const email = emailEl.value.trim();
  if (!email) { status.textContent = '⚠️ Bitte E-Mail eingeben.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Verlinken…';
  status.textContent = '';

  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:    'link-child',
        parentId:  parentCtx.user.id,
        childEmail: email,
        nickname:  nicknameEl.value.trim() || null
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Kind erfolgreich verlinkt! 🎉', 'success');
      emailEl.value    = '';
      nicknameEl.value = '';
      document.getElementById('link-child-form').style.display = 'none';
      await loadChildren();
    } else {
      status.textContent = '❌ ' + (data.error || 'Unbekannter Fehler');
    }
  } catch {
    status.textContent = '❌ Verbindungsfehler';
  }
  btn.disabled    = false;
  btn.textContent = 'Verlinken';
}

async function loadDashboard() {
  const { sb } = parentCtx;
  if (!activeChildId) { showEmptyState(); return; }

  const since = activeDays > 0
    ? new Date(Date.now() - activeDays * 86400000).toISOString()
    : new Date(0).toISOString();

  await Promise.all([
    loadSummaryStats(sb, activeChildId, since),
    loadActivities(sb, activeChildId, since),
    loadQuestions(sb, activeChildId, since),
    loadSubjectProgress(sb, activeChildId),
    loadStreak(sb, activeChildId),
    loadChallengeReviews(sb, activeChildId),
    loadSurpriseAlert(sb, activeChildId)
  ]);
}

/* ─── Summary stats ─── */
async function loadSummaryStats(sb, lennyId, since) {
  try {
    const [progressRes, sessionRes] = await Promise.all([
      sb.from('progress')
        .select('lesson_id, completed, time_spent_seconds, completed_at')
        .eq('user_id', lennyId)
        .eq('completed', true),
      sb.from('sessions')
        .select('breaks_taken, start_time')
        .eq('user_id', lennyId)
    ]);

    // Filter by date in JS to avoid Supabase filter syntax issues
    const allProgress = progressRes.data || [];
    const allSessions = sessionRes.data  || [];

    const progress = allProgress.filter(p => !since || !p.completed_at || p.completed_at >= since);
    const sessions = allSessions.filter(s => !since || !s.start_time   || s.start_time   >= since);

    const lessons   = progress.length;
    const totalSecs = progress.reduce((s, p) => s + (p.time_spent_seconds || 0), 0);
    const hours     = totalSecs >= 3600
      ? (totalSecs / 3600).toFixed(1) + 'h'
      : Math.round(totalSecs / 60) + 'min';
    const breaks    = sessions.reduce((s, s2) => s + (s2.breaks_taken || 0), 0);
    const xp        = lessons * 100;

    document.getElementById('stat-lessons').textContent  = lessons;
    document.getElementById('stat-time').textContent     = hours;
    document.getElementById('stat-xp').textContent       = xp;
    document.getElementById('stat-breaks').textContent   = breaks;
  } catch (err) {
    console.error('loadSummaryStats error:', err);
  }
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

    let actionsHtml;
    if (sub.status === 'approved') {
      actionsHtml = `<div class="challenge-review-item__approved">✅ Bestätigt · +${sub.xp_awarded || 250} XP</div>`;
    } else if (sub.status === 'rejected') {
      actionsHtml = `<div class="challenge-review-item__rejected">❌ Abgelehnt${sub.reject_reason ? ` — ${sub.reject_reason}` : ''}</div>`;
    } else {
      actionsHtml = `
        <div class="challenge-review-item__actions">
          <button class="btn btn-primary" style="font-size:.85rem;padding:8px 16px" data-action="approve" data-id="${sub.id}">✅ Bestätigen (+250 XP)</button>
          <button class="btn" style="font-size:.85rem;padding:8px 16px;margin-left:8px" data-action="reject-show" data-id="${sub.id}">❌ Ablehnen</button>
        </div>
        <div class="challenge-review-item__reject-form" id="reject-form-${sub.id}" style="display:none;margin-top:10px">
          <textarea id="reject-reason-${sub.id}" placeholder="Begründung…" style="width:100%;min-height:70px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;color:var(--text);font-family:inherit;font-size:.85rem;resize:vertical;box-sizing:border-box"></textarea>
          <button class="btn btn-primary" style="font-size:.85rem;padding:8px 16px;margin-top:8px" data-action="reject-submit" data-id="${sub.id}">Absenden</button>
        </div>
      `;
    }

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

    if (sub.status === 'pending') {
      // Approve button
      item.querySelector('[data-action="approve"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Wird bestätigt…';
        try {
          await fetch('/api/approve-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: sub.id, action: 'approve' })
          });
          showToast('Challenge bestätigt! 🎉', 'success');
          await loadChallengeReviews(sb, lennyId);
        } catch {
          btn.disabled = false;
          btn.textContent = '✅ Bestätigen (+250 XP)';
          showToast('Fehler beim Bestätigen.', 'error');
        }
      });

      // Show reject form
      item.querySelector('[data-action="reject-show"]')?.addEventListener('click', () => {
        const form = document.getElementById(`reject-form-${sub.id}`);
        if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
      });

      // Submit rejection
      item.querySelector('[data-action="reject-submit"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const reason = document.getElementById(`reject-reason-${sub.id}`)?.value.trim();
        btn.disabled = true;
        btn.textContent = 'Wird abgelehnt…';
        try {
          await fetch('/api/approve-challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: sub.id, action: 'reject', reason })
          });
          showToast('Challenge abgelehnt.', 'success');
          await loadChallengeReviews(sb, lennyId);
        } catch {
          btn.disabled = false;
          btn.textContent = 'Absenden';
          showToast('Fehler beim Ablehnen.', 'error');
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

/* ─── Emoji auto-detection ─── */
function guessEmoji(name) {
  const n = name.toLowerCase().trim();
  if (!n) return '📖';

  const map = [
    // Languages
    [/spanisch|español/,                   '🇪🇸'],
    [/englisch|english/,                   '🇬🇧'],
    [/französisch|french|français/,        '🇫🇷'],
    [/italienisch|italiano/,               '🇮🇹'],
    [/japanisch|japanese/,                 '🇯🇵'],
    [/chinesisch|chinese|mandarin/,        '🇨🇳'],
    [/latein|latin/,                       '🏛️'],
    [/sprache|language/,                   '🗣️'],
    // STEM
    [/mathe|mathematik|rechnen/,           '📐'],
    [/geometrie/,                          '📏'],
    [/physik|physics/,                     '⚛️'],
    [/chemie|chemistry/,                   '🧪'],
    [/biologie|biology/,                   '🧬'],
    [/programmier|coding|code|python|javascript|informatik/, '💻'],
    [/elektronik|elektro/,                 '🔌'],
    [/roboter|robotik/,                    '🤖'],
    [/künstliche intelligenz|ki\b|ai\b/,   '🧠'],
    [/statistik|stochastik/,              '📊'],
    [/astronomie|weltraum|sterne|raumfahrt/, '🚀'],
    // Nature / animals
    [/natur|wald|pflanze|botanik/,         '🌿'],
    [/tier|zoo|wildtier/,                  '🦁'],
    [/pferd|reiten/,                       '🐴'],
    [/hund/,                               '🐕'],
    [/katze/,                              '🐱'],
    [/haustier/,                           '🐾'],
    [/vogel/,                              '🦅'],
    [/meer|ozean|fisch|tauchen/,           '🌊'],
    [/landmaschine|traktor|landwirtschaft/, '🚜'],
    // Music
    [/gitarre/,                            '🎸'],
    [/klavier|piano/,                      '🎹'],
    [/schlagzeug|drums/,                   '🥁'],
    [/geige|violine/,                      '🎻'],
    [/flöte/,                              '🪈'],
    [/singen|gesang|chor/,                 '🎤'],
    [/musik/,                              '🎵'],
    // Arts
    [/zeichnen|malen|illustration/,        '✏️'],
    [/kunst|art\b/,                        '🎨'],
    [/design|grafik/,                      '🎨'],
    [/fotografie|foto/,                    '📷'],
    [/film|video|kamera|videoschnitt/,     '🎬'],
    [/theater|schauspiel/,                 '🎭'],
    // Sports
    [/fußball/,                            '⚽'],
    [/basketball/,                         '🏀'],
    [/tennis/,                             '🎾'],
    [/volleyball/,                         '🏐'],
    [/schwimmen/,                          '🏊'],
    [/radfahren|fahrrad/,                  '🚴'],
    [/laufen|joggen/,                      '🏃'],
    [/yoga|meditation/,                    '🧘'],
    [/tanzen|tanz/,                        '💃'],
    [/turnen/,                             '🤸'],
    [/kampfsport|judo|karate/,             '🥋'],
    [/sport|fitness|training/,             '🏋️'],
    // Life skills / business
    [/kochen|backen|küche/,                '🍳'],
    [/business|unternehmen|startup|firma/, '🏪'],
    [/finanzen|geld|investieren|wirtschaft/, '💰'],
    [/marketing|werbung/,                  '📣'],
    [/emotion|gefühl|empathie/,            '💛'],
    [/psychologie/,                        '🧠'],
    [/philosophie/,                        '💭'],
    [/geschichte|history/,                 '🏺'],
    [/geografie|geography|länder/,         '🌍'],
    [/politik/,                            '🏛️'],
    // Craft / practical
    [/handwerk|werken|basteln/,            '🔧'],
    [/lego|bauen|konstruktion/,            '🧱'],
    [/nähen|stricken|häkeln/,              '🧵'],
    [/garten|pflanzen|botanik/,            '🌱'],
    [/reisen|reise/,                       '✈️'],
  ];

  for (const [re, emoji] of map) {
    if (re.test(n)) return emoji;
  }
  return '📖';
}

/* ─── Subjects Manager ─── */
function setupSubjectsManager() {
  document.getElementById('subjects-save').addEventListener('click', saveSubjects);
  document.getElementById('new-subject-create').addEventListener('click', createSubject);

  // Auto-update emoji preview as user types the subject name
  const nameInput    = document.getElementById('new-subject-name');
  const emojiPreview = document.getElementById('new-subject-emoji-preview');

  let userEditedEmoji = false; // track if parent manually changed the emoji

  nameInput.addEventListener('input', () => {
    if (!userEditedEmoji) {
      const suggested = guessEmoji(nameInput.value);
      emojiPreview.textContent = suggested;
    }
  });

  // When parent focuses the emoji preview, mark it as manually edited
  emojiPreview.addEventListener('focus', () => { userEditedEmoji = true; });

  // Reset manual-edit flag when name input is cleared
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && nameInput.value === '') userEditedEmoji = false;
  });

  // Highlight emoji box on focus
  emojiPreview.addEventListener('focus', () => {
    emojiPreview.style.borderColor = 'var(--purple)';
    // Select all so typing replaces the current emoji
    const range = document.createRange();
    range.selectNodeContents(emojiPreview);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  emojiPreview.addEventListener('blur', () => {
    emojiPreview.style.borderColor = 'var(--border)';
    // Keep only the first emoji character
    const text = emojiPreview.textContent.trim();
    if (!text) { emojiPreview.textContent = guessEmoji(nameInput.value); userEditedEmoji = false; }
  });
}

async function loadSubjectsForChild(childId, childName) {
  const nameEl = document.getElementById('subjects-child-name');
  if (nameEl) nameEl.textContent = childName || 'dein Kind';

  const container = document.getElementById('subjects-list');
  container.innerHTML = '<div class="text-sm text-muted">Lade Fächer…</div>';

  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-subjects', childId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler');

    container.innerHTML = '';
    (data.subjects || []).forEach(subject => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:border-color .2s';
      label.innerHTML = `
        <input type="checkbox" data-id="${subject.id}" ${subject.active ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--purple)" />
        <span style="font-size:1.1rem">${subject.emoji || '📖'}</span>
        <span style="flex:1;font-size:.9rem">${subject.name}</span>
      `;
      label.querySelector('input').addEventListener('change', (e) => {
        label.style.borderColor = e.target.checked ? 'var(--purple)' : 'var(--border)';
      });
      if (subject.active) label.style.borderColor = 'var(--purple)';
      container.appendChild(label);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-sm" style="color:var(--pink)">Fehler: ${err.message}</div>`;
  }
}

async function saveSubjects() {
  if (!activeChildId) return;
  const btn    = document.getElementById('subjects-save');
  const status = document.getElementById('subjects-save-status');
  btn.disabled    = true;
  btn.textContent = 'Speichern…';
  status.textContent = '';

  const checked = [...document.querySelectorAll('#subjects-list input[type=checkbox]:checked')].map(el => el.dataset.id);

  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-child-subjects', childId: activeChildId, subjectIds: checked })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Fehler');
    status.textContent = '✅ Gespeichert!';
    showToast('Fächer gespeichert!', 'success');
  } catch (err) {
    status.textContent = '❌ ' + err.message;
    showToast('Fehler beim Speichern.', 'error');
  }

  btn.disabled    = false;
  btn.textContent = 'Speichern';
  setTimeout(() => { status.textContent = ''; }, 4000);
}

async function createSubject() {
  if (!activeChildId) { showToast('Erst ein Kind auswählen.', 'error'); return; }
  const nameEl    = document.getElementById('new-subject-name');
  const previewEl = document.getElementById('new-subject-emoji-preview');
  const statusEl  = document.getElementById('new-subject-status');
  const btn       = document.getElementById('new-subject-create');

  const name  = nameEl.value.trim();
  const emoji = (previewEl.textContent.trim() || guessEmoji(name));
  if (!name) { statusEl.textContent = '⚠️ Bitte einen Namen eingeben.'; return; }

  btn.disabled    = true;
  btn.textContent = 'Erstellen…';
  statusEl.textContent = '';

  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create-subject', name, emoji, addToChildId: activeChildId, parentId: parentCtx.user.id })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Fehler');

    nameEl.value            = '';
    previewEl.textContent   = '📖';
    statusEl.textContent = `✅ "${name}" erstellt und hinzugefügt!`;
    showToast(`Thema "${name}" erstellt! 🎉`, 'success');
    await loadSubjectsForChild(activeChildId, activeChildName);
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  }

  btn.disabled    = false;
  btn.textContent = 'Erstellen';
  setTimeout(() => { statusEl.textContent = ''; }, 5000);
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
