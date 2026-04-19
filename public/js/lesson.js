/* ── FlowSchool — Lesson page ── */

const WORDS_PER_MIN   = 200;
const BREAK_WARN_MS   = 25 * 60 * 1000;  // 25 min
const BREAK_FORCE_MS  = 27 * 60 * 1000;  // 27 min
const BREAK_DUR_S     = 5 * 60;          // 5 min pause
const LS_ACTIVE_KEY   = 'fs_active_ms';
const LS_SESSION_KEY  = 'fs_session_id';

let state = {
  sb: null, user: null,
  lessonId: null, subjectId: null, subjectName: null, title: null,
  readTimerDone: false,
  videoProgress: 0,
  videoDone: false,
  maxWatchedTime: 0,
  quizUnlocked: false,
  lessonDone: false,
  chatHistory: [],
  lessonContent: '',
  quizQuestions: [],
  quizResults: [],
  breakWarnShown: false,
  breakActive: false,
  breakCountdown: BREAK_DUR_S,
  activeMs: 0,
  activeInterval: null,
  breakInterval: null,
  youtubePlayer: null,
  ytCheckInterval: null,
  sessionId: null
};

async function initLesson() {
  const ctx = await requireAuth('lenny');
  if (!ctx) return;
  state.sb   = ctx.sb;
  state.user = ctx.user;

  const params        = new URLSearchParams(window.location.search);
  state.lessonId      = params.get('lessonId');
  state.subjectId     = params.get('subjectId');
  state.subjectName   = params.get('subjectName') || 'Lektion';
  state.title         = params.get('title')       || 'Lektion';

  if (!state.lessonId) { window.location.href = '/home'; return; }

  document.getElementById('lesson-subject-name').textContent = state.subjectName;
  document.getElementById('lesson-title').textContent        = state.title;
  document.title = state.title + ' — FlowSchool';

  document.getElementById('back-btn').addEventListener('click', () => history.back());
  document.getElementById('back-home-btn')?.addEventListener('click', () => window.location.href = '/home');

  // Restore active time from localStorage
  state.activeMs = parseInt(localStorage.getItem(LS_ACTIVE_KEY) || '0', 10);

  await startSession();
  startActiveTimer();
  setupScrollProgress();
  setupChat();
  setupBreakHandlers();

  // Load YouTube API
  loadYouTubeAPI();

  // Generate lesson content
  await generateLesson();

  hideLoader();
}

/* ─── Session tracking ─── */
async function startSession() {
  const existing = localStorage.getItem(LS_SESSION_KEY);
  if (existing) { state.sessionId = existing; return; }

  const { data } = await state.sb.from('sessions').insert({
    user_id: state.user.id, breaks_taken: 0
  }).select().single();
  if (data) {
    state.sessionId = data.id;
    localStorage.setItem(LS_SESSION_KEY, data.id);
  }
}

/* ─── Active timer + break logic ─── */
function startActiveTimer() {
  state.activeInterval = setInterval(() => {
    if (document.hidden || state.breakActive) return;
    state.activeMs += 1000;
    localStorage.setItem(LS_ACTIVE_KEY, String(state.activeMs));

    if (!state.breakWarnShown && state.activeMs >= BREAK_WARN_MS) {
      state.breakWarnShown = true;
      showBreakReminder();
    }
    if (state.activeMs >= BREAK_FORCE_MS) {
      startBreak();
    }
  }, 1000);
}

function showBreakReminder() {
  document.getElementById('break-reminder').classList.remove('hidden');
}

function startBreak() {
  document.getElementById('break-reminder').classList.add('hidden');
  document.getElementById('break-screen').classList.remove('hidden');
  state.breakActive = true;
  state.breakCountdown = BREAK_DUR_S;

  // Fetch break video
  fetchBreakVideo();

  state.breakInterval = setInterval(() => {
    state.breakCountdown--;
    const m = Math.floor(state.breakCountdown / 60);
    const s = state.breakCountdown % 60;
    document.getElementById('break-countdown').textContent =
      `${m}:${s.toString().padStart(2,'0')}`;

    if (state.breakCountdown <= 0) {
      clearInterval(state.breakInterval);
      document.getElementById('break-countdown').textContent = '0:00';
      showCheckin();
    }
  }, 1000);
}

async function fetchBreakVideo() {
  try {
    const res = await fetch('/api/youtube-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerm: 'Kinder Bewegungspause Mitmachvideo 5 Minuten', isBreak: true })
    });
    const { videoId } = await res.json();
    if (videoId) {
      const container = document.getElementById('break-video-container');
      // controls=0: keine YouTube-Controls/Links, autoplay, kein Redirect möglich
      container.innerHTML = `
        <iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&fs=0&disablekb=1&playsinline=1"
          style="position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none"
          allow="autoplay; encrypted-media" allowfullscreen></iframe>
        <div style="position:absolute;inset:0;cursor:default"></div>`;
    }
  } catch {}
}

function showCheckin() {
  document.getElementById('break-countdown').style.display = 'none';
  // Hide video, show checkin
  document.getElementById('break-video-wrap').style.display = 'none';
  document.getElementById('checkin-form').classList.remove('hidden');

  document.querySelectorAll('.checkin-emojis button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.checkin-emojis button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('checkin-done').disabled = false;
    });
  });

  document.getElementById('checkin-done').addEventListener('click', async () => {
    state.activeMs = 0;
    state.breakWarnShown = false;
    state.breakActive = false;
    localStorage.setItem(LS_ACTIVE_KEY, '0');

    // Properly increment breaks_taken
    if (state.sessionId) {
      const { data } = await state.sb.from('sessions')
        .select('breaks_taken').eq('id', state.sessionId).single().catch(() => ({ data: null }));
      if (data) {
        await state.sb.from('sessions')
          .update({ breaks_taken: (data.breaks_taken || 0) + 1 })
          .eq('id', state.sessionId).catch(() => {});
      }
    }

    document.getElementById('break-screen').classList.add('hidden');
    document.getElementById('break-video-wrap').style.display = '';
    showToast('Super! Weiter geht\'s! 💪', 'success');
  });
}

function setupBreakHandlers() {
  document.getElementById('start-break-btn').addEventListener('click', startBreak);
  document.getElementById('skip-reminder-btn').addEventListener('click', () => {
    document.getElementById('break-reminder').classList.add('hidden');
    // Give 2 more minutes before forcing
    state.activeMs = BREAK_FORCE_MS - 2 * 60 * 1000;
  });
}

/* ─── Scroll progress bar ─── */
function setupScrollProgress() {
  window.addEventListener('scroll', () => {
    const doc  = document.documentElement;
    const pct  = (doc.scrollTop / (doc.scrollHeight - doc.clientHeight)) * 100;
    document.getElementById('scroll-progress').style.width = Math.min(pct, 100) + '%';
  });
}

/* ─── Generate lesson ─── */
async function generateLesson() {
  try {
    const res = await fetch('/api/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectName: state.subjectName,
        lessonTitle: state.title
      })
    });
    const data = await res.json();

    state.lessonContent  = data.content || '';
    state.quizQuestions  = data.quizQuestions || [];

    // Render content
    document.getElementById('lesson-content').innerHTML = state.lessonContent;

    // Start read timer
    const wordCount  = state.lessonContent.replace(/<[^>]+>/g,'').split(/\s+/).length;
    const readSecs   = Math.max(30, Math.round((wordCount / WORDS_PER_MIN) * 60));
    startReadTimer(readSecs);

    // Load video
    if (data.videoSearchTerm) {
      loadVideo(data.videoSearchTerm);
    }

  } catch (err) {
    document.getElementById('lesson-content').innerHTML =
      '<p>Lektion konnte nicht geladen werden. Bitte neu laden.</p>';
    console.error(err);
  }
}

/* ─── Read timer ─── */
function startReadTimer(seconds) {
  let remaining = seconds;
  updateTimerDisplay(remaining);

  const interval = setInterval(() => {
    remaining--;
    updateTimerDisplay(remaining);
    if (remaining <= 0) {
      clearInterval(interval);
      state.readTimerDone = true;
      document.getElementById('timer-notice').innerHTML =
        '✅ Lesezeit abgeschlossen! Schau jetzt das Video.';
      checkContinueUnlock();
    }
  }, 1000);
}

function updateTimerDisplay(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const el = document.getElementById('timer-display');
  if (el) el.textContent = `${m}:${sec.toString().padStart(2,'0')}`;
}

/* ─── YouTube video ─── */
function loadYouTubeAPI() {
  if (window.YT) return;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function() {
  // Player created after video ID is known
};

async function loadVideo(searchTerm) {
  try {
    const res = await fetch('/api/youtube-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerm })
    });
    const { videoId } = await res.json();
    if (!videoId) return;

    const wrapper = document.getElementById('video-wrapper');
    wrapper.innerHTML = `<div id="yt-player" style="position:absolute;inset:0"></div>`;

    const tryCreate = () => {
      if (!window.YT || !window.YT.Player) { setTimeout(tryCreate, 300); return; }
      state.youtubePlayer = new YT.Player('yt-player', {
        videoId,
        width: '100%', height: '100%',
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange: onYTStateChange
        }
      });
    };
    tryCreate();

    // Poll video progress
    state.ytCheckInterval = setInterval(updateVideoProgress, 1000);

  } catch (err) {
    console.error('Video load error', err);
  }
}

function onYTStateChange(event) {
  updateVideoProgress();
}

function updateVideoProgress() {
  const p = state.youtubePlayer;
  if (!p || typeof p.getDuration !== 'function') return;
  const duration = p.getDuration();
  const current  = p.getCurrentTime();
  if (!duration) return;

  // Vorspulen verhindern: wenn mehr als 3s vorgesprungen, zurücksetzen
  if (current > state.maxWatchedTime + 3) {
    p.seekTo(state.maxWatchedTime, true);
    showToast('Bitte das Video nicht vorspulen! 😅', 'error');
    return;
  }
  state.maxWatchedTime = Math.max(state.maxWatchedTime, current);

  const pct = (current / duration) * 100;
  state.videoProgress = pct;
  document.getElementById('video-progress-fill').style.width = Math.min(pct, 100) + '%';

  const remaining = Math.ceil((duration - current) / 60);
  if (!state.videoDone) {
    document.getElementById('video-hint').textContent =
      pct < 95 ? `Schau das gesamte Video — noch ca. ${remaining} Min` : '✅ Video vollständig geschaut!';
  }

  if (pct >= 95 && !state.videoDone) {
    state.videoDone = true;
    document.getElementById('video-hint').textContent = '✅ Video vollständig geschaut!';
    document.getElementById('video-hint').style.color = 'var(--green)';
    checkContinueUnlock();
  }
}

/* ─── Continue unlock ─── */
function checkContinueUnlock() {
  if (state.readTimerDone && state.videoDone) {
    document.getElementById('continue-btn').disabled = false;
    document.getElementById('footer-info').textContent = 'Bereit! Jetzt Lernkontrolle starten';
    document.getElementById('continue-btn').addEventListener('click', unlockQuiz, { once: true });
  }
}

function unlockQuiz() {
  state.quizUnlocked = true;

  // Lektion ausblenden damit nicht abgeschrieben werden kann
  document.getElementById('lesson-content').style.display = 'none';
  document.getElementById('video-section').style.display = 'none';
  document.getElementById('chat-section').style.display = 'none';
  document.getElementById('timer-notice').style.display = 'none';

  document.getElementById('quiz-section').classList.remove('hidden');
  document.getElementById('continue-btn').disabled = true;
  document.getElementById('footer-info').textContent = 'Beantworte die Fragen mit eigenen Worten (min. 25 Wörter)';

  const container = document.getElementById('quiz-questions');
  container.innerHTML = '';
  state.quizQuestions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'quiz-question';
    div.innerHTML = `
      <div class="quiz-question__text">${i + 1}. ${q}</div>
      <div class="quiz-question__input" style="display:flex;gap:8px;align-items:flex-start">
        <textarea placeholder="Erkläre mit eigenen Worten — mindestens 25 Wörter…" id="quiz-answer-${i}" rows="4" style="flex:1"></textarea>
        <button class="btn btn-secondary btn-sm" id="mic-btn-${i}" title="Spracheingabe" style="padding:8px;font-size:1.2rem;flex-shrink:0">🎤</button>
      </div>
      <div class="quiz-word-count text-muted text-sm" id="quiz-wc-${i}">0 Wörter</div>
      <div class="quiz-feedback hidden" id="quiz-feedback-${i}"></div>
    `;
    container.appendChild(div);

    // Wort-Zähler
    document.getElementById(`quiz-answer-${i}`).addEventListener('input', () => {
      const wc = countWords(document.getElementById(`quiz-answer-${i}`).value);
      const el = document.getElementById(`quiz-wc-${i}`);
      el.textContent = `${wc} Wörter ${wc >= 25 ? '✅' : '(min. 25)'}`;
      el.style.color = wc >= 25 ? 'var(--green)' : '';
    });

    // Spracheingabe
    document.getElementById(`mic-btn-${i}`).addEventListener('click', () => startVoiceInput(i));
  });

  document.getElementById('quiz-submit').addEventListener('click', submitQuiz);
  document.getElementById('quiz-section').scrollIntoView({ behavior: 'smooth' });
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function startVoiceInput(index) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Spracherkennung nicht unterstützt (Chrome empfohlen)', 'error'); return; }
  const rec = new SR();
  rec.lang = 'de-DE';
  rec.interimResults = false;
  const btn = document.getElementById(`mic-btn-${index}`);
  btn.textContent = '🔴';
  btn.disabled = true;
  rec.onresult = e => {
    const ta = document.getElementById(`quiz-answer-${index}`);
    ta.value += (ta.value ? ' ' : '') + e.results[0][0].transcript;
    ta.dispatchEvent(new Event('input'));
  };
  rec.onerror = () => showToast('Spracherkennung fehlgeschlagen', 'error');
  rec.onend = () => { btn.textContent = '🎤'; btn.disabled = false; };
  rec.start();
}

/* ─── Quiz submit ─── */
async function submitQuiz() {
  const btn = document.getElementById('quiz-submit');
  btn.disabled = true;
  btn.textContent = 'Wird bewertet…';

  let allPassed = true;

  for (let i = 0; i < state.quizQuestions.length; i++) {
    const answer   = document.getElementById(`quiz-answer-${i}`)?.value?.trim() || '';
    const feedback = document.getElementById(`quiz-feedback-${i}`);

    if (!answer) {
      feedback.textContent = 'Bitte beantworte diese Frage.';
      feedback.className = 'quiz-feedback fail';
      feedback.classList.remove('hidden');
      allPassed = false;
      continue;
    }

    const wc = countWords(answer);
    if (wc < 25) {
      feedback.textContent = `Zu kurz! Du hast nur ${wc} Wörter — bitte mindestens 25 Wörter in eigenen Worten schreiben.`;
      feedback.className = 'quiz-feedback fail';
      feedback.classList.remove('hidden');
      allPassed = false;
      continue;
    }

    try {
      const res = await fetch('/api/grade-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:      state.quizQuestions[i],
          answer,
          lessonContent: state.lessonContent.replace(/<[^>]+>/g, '')
        })
      });
      const { passed, feedback: fb } = await res.json();
      feedback.textContent = fb;
      feedback.className = `quiz-feedback ${passed ? 'pass' : 'fail'}`;
      feedback.classList.remove('hidden');
      if (!passed) allPassed = false;
    } catch {
      feedback.textContent = 'Bewertung fehlgeschlagen.';
      feedback.className = 'quiz-feedback fail';
      feedback.classList.remove('hidden');
      allPassed = false;
    }
  }

  if (allPassed) {
    await completeLesson();
  } else {
    btn.disabled = false;
    btn.textContent = 'Nochmal versuchen';
    showToast('Nicht ganz — lies den Hinweis und versuch es nochmal!', 'error');
  }
}

/* ─── Complete lesson ─── */
async function completeLesson() {
  state.lessonDone = true;

  // Save progress
  await state.sb.from('progress').upsert({
    user_id:    state.user.id,
    lesson_id:  state.lessonId,
    completed:  true,
    score:      100,
    time_spent_seconds: Math.round(state.activeMs / 1000),
    completed_at: new Date().toISOString()
  }, { onConflict: 'user_id,lesson_id' });

  document.getElementById('quiz-section').classList.add('hidden');
  document.getElementById('complete-banner').classList.remove('hidden');
  document.getElementById('continue-btn').classList.add('hidden');
  document.getElementById('complete-banner').scrollIntoView({ behavior: 'smooth' });
  showToast('Lektion abgeschlossen! 🎉', 'success');

  // Load next lesson
  loadNextLesson();
}

async function loadNextLesson() {
  const { data: current } = await state.sb.from('lessons').select('sort_order, subject_id').eq('id', state.lessonId).single();
  if (!current) return;

  const { data: next } = await state.sb.from('lessons')
    .select('*')
    .eq('subject_id', current.subject_id)
    .gt('sort_order', current.sort_order)
    .order('sort_order')
    .limit(1)
    .single();

  const btn = document.getElementById('next-lesson-btn');
  if (!btn) return;

  if (next) {
    btn.addEventListener('click', () => {
      const params = new URLSearchParams({
        lessonId: next.id, subjectId: state.subjectId,
        subjectName: state.subjectName, title: next.title
      });
      window.location.href = `/lesson?${params}`;
    });
  } else {
    btn.textContent = 'Zurück zur Übersicht';
    btn.addEventListener('click', () => window.location.href = '/home');
  }
}

/* ─── Chat ─── */
function setupChat() {
  document.getElementById('chat-toggle').addEventListener('click', () => {
    const body  = document.getElementById('chat-body');
    const arrow = document.getElementById('chat-arrow');
    body.classList.toggle('open');
    arrow.classList.toggle('open');
  });

  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  appendChatMsg(question, 'user');

  const thinkingId = appendChatMsg('…', 'ai');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonContent: state.lessonContent.replace(/<[^>]+>/g,''),
        lessonTitle:   state.title,
        question,
        history: state.chatHistory.slice(-6)
      })
    });
    const { answer } = await res.json();

    const el = document.getElementById(thinkingId);
    if (el) el.textContent = answer;

    state.chatHistory.push({ role: 'user', content: question });
    state.chatHistory.push({ role: 'assistant', content: answer });

    // Save to DB
    await state.sb.from('chat_messages').insert({
      user_id:   state.user.id,
      lesson_id: state.lessonId,
      question,
      answer
    });
  } catch {
    const el = document.getElementById(thinkingId);
    if (el) el.textContent = 'Fehler beim Laden der Antwort.';
  }
}

function appendChatMsg(text, role) {
  const messages = document.getElementById('chat-messages');
  const id = 'msg-' + Date.now();
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.innerHTML = `
    <div class="chat-msg__avatar">${role === 'user' ? 'L' : 'AI'}</div>
    <div class="chat-msg__bubble" id="${id}">${text}</div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}
