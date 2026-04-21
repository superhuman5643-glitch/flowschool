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
  mcQuestions: [],
  quizResults: [],
  quizAttempts: 0,
  breakWarnShown: false,
  breakActive: false,
  breakCountdown: BREAK_DUR_S,
  activeMs: 0,
  activeInterval: null,
  breakInterval: null,
  youtubePlayer: null,
  ytCheckInterval: null,
  seekLockUntil: null,
  sessionId: null,
  currentRec: null,
  currentRecIndex: null
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

  // Restore active time from localStorage — reset if it's a new day
  const savedDate = localStorage.getItem('fs_active_date');
  const today = new Date().toISOString().split('T')[0];
  if (savedDate !== today) {
    localStorage.setItem(LS_ACTIVE_KEY, '0');
    localStorage.setItem('fs_active_date', today);
    state.activeMs = 0;
  } else {
    state.activeMs = parseInt(localStorage.getItem(LS_ACTIVE_KEY) || '0', 10);
  }

  window._BREAK_WARN_MS  = BREAK_WARN_MS;
  window._BREAK_FORCE_MS = BREAK_FORCE_MS;

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
    user_id: state.user.id, breaks_taken: 0,
    start_time: new Date().toISOString()
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
    localStorage.setItem('fs_active_date', new Date().toISOString().split('T')[0]);

    if (!state.breakWarnShown && state.activeMs >= window._BREAK_WARN_MS) {
      state.breakWarnShown = true;
      showBreakReminder();
    }
    if (state.activeMs >= window._BREAK_FORCE_MS) {
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

  // Pause lesson video while on break
  if (state.youtubePlayer && typeof state.youtubePlayer.pauseVideo === 'function') {
    try { state.youtubePlayer.pauseVideo(); } catch {}
  }

  fetchBreakVideo();
  setupCheckin();
}

async function fetchBreakVideo() {
  try {
    // Abwechslungsreiche Suchbegriffe – jede Pause fühlt sich anders an
    const breakTerms = [
      'Kinder Bewegungspause Mitmachvideo',
      'Kinderyoga Mitmachen Schule',
      'Bewegungsspiele Kinder Pause',
      'Kinder Stretching Pause Mitmachen',
      'Tanzen Kinder Mitmach Pause',
      'Zumba Kids Mitmachen',
      'Aerobic Kinder Bewegung',
      'Kinder Brain Break Bewegung',
      'Aktive Pause Grundschule Mitmachen',
      'Kinder Sport Pause lustig',
    ];
    const searchTerm = breakTerms[Math.floor(Math.random() * breakTerms.length)];

    const res = await fetch('/api/youtube-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchTerm, isBreak: true })
    });
    const { videoId } = await res.json();
    if (!videoId) {
      document.getElementById('break-video-status').textContent = 'Kein Video gefunden — mach trotzdem eine kurze Pause! 🏃';
      // Show checkin after 60s fallback
      setTimeout(showCheckin, 60000);
      return;
    }

    const container = document.getElementById('break-video-container');
    container.innerHTML = `<div id="break-yt-player" style="position:absolute;inset:0"></div>`;
    document.getElementById('break-video-status').textContent = '▶️ Mach mit!';

    const tryCreate = () => {
      if (!window.YT || !window.YT.Player) { setTimeout(tryCreate, 300); return; }
      let breakMaxWatched = 0;
      state.breakPlayer = new YT.Player('break-yt-player', {
        videoId,
        width: '100%', height: '100%',
        playerVars: {
          rel: 0, modestbranding: 1, autoplay: 1, playsinline: 1,
          controls: 0,       // hide ALL YouTube chrome
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          cc_load_policy: 0
        },
        events: {
          onReady: (e) => { setupBreakControls(e.target); },
          onStateChange: (e) => {
            // Sync play/pause button
            const ppBtn = document.getElementById('break-playpause');
            if (ppBtn) {
              if (e.data === YT.PlayerState.PLAYING) ppBtn.textContent = '⏸ Pause';
              else if (e.data === YT.PlayerState.PAUSED) ppBtn.textContent = '▶️ Play';
            }
            if (e.data === YT.PlayerState.ENDED) { showCheckin(); return; }
            // Prevent seeking in break video too
            const bp = state.breakPlayer;
            if (!bp || typeof bp.getCurrentTime !== 'function') return;
            const cur = bp.getCurrentTime();
            if (cur > breakMaxWatched + 1) {
              bp.seekTo(breakMaxWatched, true);
            } else {
              breakMaxWatched = Math.max(breakMaxWatched, cur);
            }
          }
        }
      });
    };
    tryCreate();
  } catch {
    document.getElementById('break-video-status').textContent = 'Video konnte nicht geladen werden.';
    setTimeout(showCheckin, 60000);
  }
}

function setupBreakControls(player) {
  // Overlay: blocks all YouTube links, click = toggle play/pause
  const container = document.getElementById('break-video-container');
  if (container && !container.querySelector('#break-yt-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'break-yt-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10;cursor:pointer';
    overlay.addEventListener('click', () => {
      try {
        const s = player.getPlayerState();
        if (s === YT.PlayerState.PLAYING) { player.pauseVideo(); }
        else { player.playVideo(); }
      } catch {}
    });
    container.appendChild(overlay);
  }

  // Show break custom controls
  const bar = document.getElementById('break-custom-controls');
  if (bar) bar.style.display = 'flex';

  // Play/Pause
  const ppBtn = document.getElementById('break-playpause');
  if (ppBtn) {
    ppBtn.addEventListener('click', () => {
      try {
        const s = player.getPlayerState();
        if (s === YT.PlayerState.PLAYING) { player.pauseVideo(); ppBtn.textContent = '▶️ Play'; }
        else { player.playVideo(); ppBtn.textContent = '⏸ Pause'; }
      } catch {}
    });
  }

  // Rewind 15s
  const breakRewindBtn = document.getElementById('break-rewind');
  if (breakRewindBtn) {
    breakRewindBtn.addEventListener('click', () => {
      try { player.seekTo(Math.max(0, player.getCurrentTime() - 15), true); } catch {}
    });
  }

  // Mute
  const muteBtn = document.getElementById('break-mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      try {
        if (player.isMuted()) { player.unMute(); muteBtn.textContent = '🔊 Ton an'; }
        else { player.mute(); muteBtn.textContent = '🔇 Ton aus'; }
      } catch {}
    });
  }
}

function showCheckin() {
  // Stop break video
  try { state.breakPlayer?.stopVideo?.(); } catch {}
  document.getElementById('break-video-wrap').style.display = 'none';
  document.getElementById('break-video-status').style.display = 'none';
  document.getElementById('checkin-form').classList.remove('hidden');
}

function setupCheckin() {
  // Clear duplicate listeners from previous breaks by cloning nodes
  document.querySelectorAll('.checkin-emojis button').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
  });
  const doneBtn = document.getElementById('checkin-done');
  const freshDone = doneBtn.cloneNode(true);
  doneBtn.parentNode.replaceChild(freshDone, doneBtn);

  document.querySelectorAll('.checkin-emojis button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.checkin-emojis button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('checkin-done').disabled = false;
    });
  });

  document.getElementById('checkin-done').addEventListener('click', async () => {
    try {
      if (state.sessionId) {
        const { data } = await state.sb.from('sessions')
          .select('breaks_taken').eq('id', state.sessionId).single();
        if (data) {
          await state.sb.from('sessions')
            .update({ breaks_taken: (data.breaks_taken || 0) + 1 })
            .eq('id', state.sessionId);
        }
      }
    } catch {}

    // Show extra break option
    document.getElementById('checkin-form').classList.add('hidden');
    document.getElementById('extra-break').classList.remove('hidden');
  }, { once: true });

  document.getElementById('extra-break-no').addEventListener('click', () => endBreak(), { once: true });

  document.getElementById('extra-break-yes').addEventListener('click', () => {
    document.getElementById('extra-break-yes').disabled = true;
    document.getElementById('extra-break-no').disabled = true;
    document.getElementById('extra-break-countdown').classList.remove('hidden');

    let secs = 5 * 60;
    const display = document.getElementById('extra-countdown-display');
    const tick = setInterval(() => {
      secs--;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      display.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      if (secs <= 0) { clearInterval(tick); endBreak(); }
    }, 1000);

    // Allow early finish
    document.getElementById('extra-break-no').disabled = false;
    document.getElementById('extra-break-no').textContent = 'Ich bin bereit! 💪';
    document.getElementById('extra-break-no').addEventListener('click', () => { clearInterval(tick); endBreak(); }, { once: true });
  }, { once: true });
}

function endBreak() {
  state.activeMs = 0;
  state.breakWarnShown = false;
  state.breakActive = false;
  localStorage.setItem(LS_ACTIVE_KEY, '0');

  // Stop & destroy break player
  try { state.breakPlayer?.stopVideo?.(); } catch {}
  state.breakPlayer = null;

  // Reset break screen fully
  document.getElementById('break-video-wrap').style.display = '';
  document.getElementById('break-video-status').style.display = '';
  document.getElementById('break-video-status').textContent = '⏳ Lade Bewegungsvideo…';
  document.getElementById('break-video-container').innerHTML = '';   // removes overlay too
  const bcc = document.getElementById('break-custom-controls');
  if (bcc) bcc.style.display = 'none';
  document.getElementById('checkin-form').classList.add('hidden');
  document.getElementById('checkin-done').disabled = true;
  document.getElementById('extra-break').classList.add('hidden');
  document.getElementById('extra-break-countdown').classList.add('hidden');
  document.getElementById('extra-break-yes').disabled = false;
  document.getElementById('extra-break-no').disabled = false;
  document.getElementById('extra-break-no').textContent = 'Nein, ich bin bereit! 💪';
  document.querySelectorAll('.checkin-emojis button').forEach(b => b.classList.remove('selected'));
  document.getElementById('break-screen').classList.add('hidden');

  showToast('Super! Weiter geht\'s! 💪', 'success');
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
        lessonTitle: state.title,
        userId: state.user?.id,
        lessonId: state.lessonId
      })
    });
    const data = await res.json();

    state.lessonContent  = data.content || '';
    state.quizQuestions  = data.quizQuestions || [];
    state.mcQuestions    = data.mcQuestions   || [];

    // Render content
    document.getElementById('lesson-content').innerHTML = state.lessonContent;

    // Start read timer — minimum 5 minutes, timer hidden
    const wordCount  = state.lessonContent.replace(/<[^>]+>/g,'').split(/\s+/).length;
    const readSecs   = Math.max(300, Math.round((wordCount / WORDS_PER_MIN) * 60));
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
  // Hide the countdown — just wait silently
  const noticeEl = document.getElementById('timer-notice');
  if (noticeEl) noticeEl.style.display = 'none';

  setTimeout(() => {
    state.readTimerDone = true;
    checkContinueUnlock();
  }, seconds * 1000);
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

    state.currentVideoId = videoId;

    const wrapper = document.getElementById('video-wrapper');
    const thumb   = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    wrapper.innerHTML = `
      <div id="yt-thumb" style="
        position:absolute;inset:0;
        background:url('${thumb}') center/cover no-repeat;
        cursor:pointer;
        display:flex;align-items:center;justify-content:center;
      ">
        <div style="
          width:64px;height:64px;border-radius:50%;
          background:rgba(255,0,0,.9);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 4px 20px rgba(0,0,0,.5);
          transition:transform .15s;
        " onmouseenter="this.style.transform='scale(1.1)'" onmouseleave="this.style.transform=''">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>`;

    document.getElementById('yt-thumb').addEventListener('click', () => activateYTPlayer(videoId), { once: true });

  } catch (err) {
    console.error('Video load error', err);
  }
}

function activateYTPlayer(videoId) {
  const wrapper = document.getElementById('video-wrapper');
  wrapper.innerHTML = `<div id="yt-player" style="position:absolute;inset:0"></div>`;

  if (state.ytCheckInterval) { clearInterval(state.ytCheckInterval); state.ytCheckInterval = null; }

  const tryCreate = () => {
    if (!window.YT || !window.YT.Player) { setTimeout(tryCreate, 300); return; }
    state.youtubePlayer = new YT.Player('yt-player', {
      videoId,
      width: '100%', height: '100%',
      playerVars: {
        rel: 0, modestbranding: 1, autoplay: 1, playsinline: 1,
        controls: 0,       // hide ALL YouTube chrome (logo, title, links)
        disablekb: 1,      // disable keyboard shortcuts → no escape to YouTube
        fs: 0,             // no fullscreen button
        iv_load_policy: 3, // no annotations
        cc_load_policy: 0  // no auto-captions overlay
      },
      events: {
        onReady: (e) => {
          state.ytCheckInterval = setInterval(updateVideoProgress, 500);
          setupVideoControls(e.target);
        },
        onStateChange: onYTStateChange
      }
    });
  };
  tryCreate();
}

function setupVideoControls(player) {
  // Overlay: intercepts ALL clicks → routes to play/pause, blocks every YouTube link
  const wrapper = document.getElementById('video-wrapper');
  if (!wrapper.querySelector('#yt-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'yt-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10;cursor:pointer';
    overlay.addEventListener('click', () => {
      try {
        const s = player.getPlayerState();
        if (s === YT.PlayerState.PLAYING) { player.pauseVideo(); }
        else { player.playVideo(); }
      } catch {}
    });
    wrapper.appendChild(overlay);
  }

  // Show custom controls bar
  const bar = document.getElementById('video-custom-controls');
  if (bar) bar.style.display = 'flex';

  // Play/Pause button
  const ppBtn = document.getElementById('yt-playpause');
  if (ppBtn) {
    ppBtn.addEventListener('click', () => {
      try {
        const s = player.getPlayerState();
        if (s === YT.PlayerState.PLAYING) { player.pauseVideo(); ppBtn.textContent = '▶️ Play'; }
        else { player.playVideo(); ppBtn.textContent = '⏸ Pause'; }
      } catch {}
    });
  }

  // Rewind 15s button
  const rewindBtn = document.getElementById('yt-rewind');
  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      try { player.seekTo(Math.max(0, player.getCurrentTime() - 15), true); } catch {}
    });
  }

  // Mute button
  const muteBtn = document.getElementById('yt-mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      try {
        if (player.isMuted()) { player.unMute(); muteBtn.textContent = '🔊 Ton an'; }
        else { player.mute(); muteBtn.textContent = '🔇 Ton aus'; }
      } catch {}
    });
  }

  // Sync play/pause button with actual player state
  const origStateChange = window._origYTStateChange;
  player.addEventListener('onStateChange', (e) => {
    if (!ppBtn) return;
    if (e.data === YT.PlayerState.PLAYING) ppBtn.textContent = '⏸ Pause';
    else if (e.data === YT.PlayerState.PAUSED) ppBtn.textContent = '▶️ Play';
  });
}

function onYTStateChange(event) {
  // Only check seek on PAUSED (2) or PLAYING (1) — not on BUFFERING (3) to avoid false triggers
  if (event.data === 1 || event.data === 2) {
    updateVideoProgress(event.target);
  }
  // Video ended (0) — overlay already in place, just mark done if not yet
  if (event.data === 0 && !state.videoDone) {
    state.videoDone = true;
    document.getElementById('video-hint').textContent = '✅ Video vollständig geschaut!';
    document.getElementById('video-hint').style.color = 'var(--green)';
    checkContinueUnlock();
  }
}

function updateVideoProgress(playerArg) {
  const p = playerArg || state.youtubePlayer;
  if (!p || typeof p.getDuration !== 'function') return;
  const duration = p.getDuration();
  const current  = p.getCurrentTime();
  if (!duration || current == null) return;

  // Vorspulen verhindern — lock prevents seekTo from triggering another seekTo
  const now = Date.now();
  if (current > state.maxWatchedTime + 2) {
    if (!state.seekLockUntil || now > state.seekLockUntil) {
      state.seekLockUntil = now + 1500;
      p.seekTo(state.maxWatchedTime, true);
      showToast('⏪ Vorspulen ist nicht erlaubt!', 'error');
    }
    return;
  }

  if (!state.seekLockUntil || now > state.seekLockUntil) {
    state.maxWatchedTime = Math.max(state.maxWatchedTime, current);
  }

  const pct = (current / duration) * 100;
  state.videoProgress = pct;
  document.getElementById('video-progress-fill').style.width = Math.min(pct, 100) + '%';

  const remaining = Math.ceil((duration - current) / 60);
  if (!state.videoDone) {
    document.getElementById('video-hint').textContent =
      pct < 95 ? `Schau das gesamte Video — noch ca. ${remaining} Min` : '✅ Video vollständig geschaut!';
  }

  if (pct >= 90 && !state.videoDone) {
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
  document.getElementById('footer-info').textContent = 'Beantworte die Fragen mit eigenen Worten (min. 15 Wörter)';

  // "Lektion nochmal lesen" toggle — nur Text, kein Video/Chat/Fragen
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn btn-secondary btn-sm';
  toggleBtn.style.cssText = 'margin-bottom:20px;width:100%';
  toggleBtn.textContent = '📖 Lektion nochmal lesen';
  let lessonVisible = false;

  const lessonReview = document.createElement('div');
  lessonReview.style.cssText = 'display:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:20px;max-height:60vh;overflow-y:auto';
  // Strip interactive elements — only show text content
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = state.lessonContent;
  tempDiv.querySelectorAll('button,input,textarea,select,a').forEach(el => el.replaceWith(document.createTextNode(el.textContent)));
  lessonReview.innerHTML = tempDiv.innerHTML;

  toggleBtn.addEventListener('click', () => {
    lessonVisible = !lessonVisible;
    lessonReview.style.display = lessonVisible ? 'block' : 'none';
    toggleBtn.textContent = lessonVisible ? '📖 Lektion schließen' : '📖 Lektion nochmal lesen';
    if (lessonVisible) lessonReview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const quizContainer = document.getElementById('quiz-section');
  quizContainer.insertBefore(lessonReview, quizContainer.firstChild);
  quizContainer.insertBefore(toggleBtn, quizContainer.firstChild);

  const container = document.getElementById('quiz-questions');
  container.innerHTML = '';

  // Open questions
  state.quizQuestions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'quiz-question';
    div.innerHTML = `
      <div class="quiz-question__text">${i + 1}. ${q}</div>
      <div class="quiz-question__input" style="display:flex;gap:8px;align-items:flex-start">
        <textarea placeholder="Erkläre mit eigenen Worten — mindestens 15 Wörter…" id="quiz-answer-${i}" rows="4" style="flex:1"></textarea>
        <button class="btn btn-secondary btn-sm" id="mic-btn-${i}" title="Spracheingabe starten/stoppen" style="padding:8px;font-size:1.1rem;flex-shrink:0">🎤</button>
      </div>
      <div class="quiz-word-count text-muted text-sm" id="quiz-wc-${i}">0 Wörter</div>
      <div class="quiz-feedback hidden" id="quiz-feedback-${i}"></div>
    `;
    container.appendChild(div);
    document.getElementById(`quiz-answer-${i}`).addEventListener('input', () => {
      const wc = countWords(document.getElementById(`quiz-answer-${i}`).value);
      const el = document.getElementById(`quiz-wc-${i}`);
      el.textContent = `${wc} Wörter ${wc >= 15 ? '✅' : '(min. 25)'}`;
      el.style.color = wc >= 15 ? 'var(--green)' : '';
    });
    document.getElementById(`mic-btn-${i}`).addEventListener('click', () => startVoiceInput(i));
  });

  // Multiple-choice questions
  const mcOffset = state.quizQuestions.length;
  state.mcQuestions.forEach((mc, i) => {
    const idx = mcOffset + i;
    const div = document.createElement('div');
    div.className = 'quiz-question';
    const opts = mc.options.map((opt, oi) => `
      <label class="mc-option" id="mc-label-${idx}-${oi}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:8px;transition:.15s">
        <input type="radio" name="mc-${idx}" value="${oi}" style="accent-color:var(--purple)">
        <span>${opt}</span>
      </label>`).join('');
    div.innerHTML = `
      <div class="quiz-question__text">${idx + 1}. ${mc.question}</div>
      <div id="mc-opts-${idx}" style="margin-top:10px">${opts}</div>
      <div class="quiz-feedback hidden" id="quiz-feedback-${idx}"></div>
    `;
    container.appendChild(div);
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

  const btn = document.getElementById(`mic-btn-${index}`);

  // Toggle: if already recording for this index, stop
  if (state.currentRec && state.currentRecIndex === index) {
    state.currentRec.stop();
    state.currentRec = null;
    btn.textContent = '🎤';
    return;
  }
  // Stop any other active recording
  if (state.currentRec) { state.currentRec.stop(); state.currentRec = null; }

  const rec = new SR();
  rec.lang = 'de-DE';
  rec.continuous = true;
  rec.interimResults = false;
  state.currentRec = rec;
  state.currentRecIndex = index;

  btn.textContent = '🔴 Stopp';
  btn.style.background = 'rgba(255,50,50,.2)';

  rec.onresult = e => {
    const ta = document.getElementById(`quiz-answer-${index}`);
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        ta.value += (ta.value ? ' ' : '') + e.results[i][0].transcript;
        ta.dispatchEvent(new Event('input'));
      }
    }
  };
  rec.onerror = () => {
    showToast('Spracherkennung fehlgeschlagen', 'error');
    btn.textContent = '🎤'; btn.style.background = '';
    state.currentRec = null;
  };
  rec.onend = () => {
    btn.textContent = '🎤'; btn.style.background = '';
    if (state.currentRec === rec) state.currentRec = null;
  };
  rec.start();
}

/* ─── Quiz submit ─── */
async function submitQuiz() {
  const btn = document.getElementById('quiz-submit');
  btn.disabled = true;
  btn.textContent = 'Wird bewertet…';

  state.quizAttempts++;
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
    if (wc < 15) {
      feedback.textContent = `Zu kurz! Du hast nur ${wc} Wörter — bitte mindestens 15 Wörter in eigenen Worten schreiben.`;
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

  // Grade MC questions client-side
  const mcOffset = state.quizQuestions.length;
  state.mcQuestions.forEach((mc, i) => {
    const idx      = mcOffset + i;
    const selected = document.querySelector(`input[name="mc-${idx}"]:checked`);
    const feedback = document.getElementById(`quiz-feedback-${idx}`);
    if (!selected) {
      feedback.textContent = 'Bitte wähle eine Antwort aus.';
      feedback.className = 'quiz-feedback fail';
      feedback.classList.remove('hidden');
      allPassed = false;
      return;
    }
    const correct = parseInt(selected.value) === mc.correct;
    feedback.textContent = correct
      ? `✅ Richtig! "${mc.options[mc.correct]}" ist korrekt.`
      : `❌ Leider falsch. Die richtige Antwort war: "${mc.options[mc.correct]}"`;
    feedback.className = `quiz-feedback ${correct ? 'pass' : 'fail'}`;
    feedback.classList.remove('hidden');
    if (!correct) allPassed = false;
  });

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

  // Update Gehirn — fire-and-forget
  const quizAnswers = state.quizQuestions.map((_, i) =>
    document.getElementById(`quiz-answer-${i}`)?.value?.trim() || '');

  fetch('/api/update-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: state.user.id,
      type: 'quiz',
      data: { questions: state.quizQuestions, answers: quizAnswers,
              passed: true, attempts: state.quizAttempts,
              subject: state.subjectName, lessonTitle: state.title }
    })
  }).catch(() => {});

  if (state.chatHistory.length >= 2) {
    fetch('/api/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.user.id,
        type: 'chat',
        data: { chatHistory: state.chatHistory.slice(-12), lessonTitle: state.title }
      })
    }).catch(() => {});
  }

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

  // Detect level boundary: sort_order divisible by 5 = last lesson of a level
  const completedLevel = Math.ceil(current.sort_order / 5);
  const isLevelEnd = current.sort_order % 5 === 0;

  if (isLevelEnd) {
    // Fire level-up immediately to generate challenge + next lessons
    fetch('/api/level-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId:      state.user.id,
        subjectId:   state.subjectId,
        subjectName: state.subjectName,
        completedLevel
      })
    }).catch(() => {});
  }

  const btn = document.getElementById('next-lesson-btn');
  if (!btn) return;

  if (next && !isLevelEnd) {
    // Next lesson is in the same level — go directly
    btn.addEventListener('click', () => {
      const params = new URLSearchParams({
        lessonId: next.id, subjectId: state.subjectId,
        subjectName: state.subjectName, title: next.title
      });
      window.location.href = `/lesson?${params}`;
    });
  } else {
    // Level finished — send back to subject list to see the challenge
    btn.textContent = isLevelEnd ? '🎯 Zur Praktischen Übung' : 'Zurück zur Übersicht';
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
