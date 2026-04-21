/* ── FlowSchool — Kleinkind-Modus ── */

const MASCOTS = ['🦁', '🐻', '🦊', '🐼', '🐨', '🐯'];

let kk = {
  childId: null,
  childName: 'Hallo',
  subjects: [],
  currentSubject: null,
  currentLesson: null,
  sessionStars: 0,
  lessonsToday: 0,
  mascot: '🦁',
  sentenceIndex: 0,
  quizAnswered: false,
};

async function initKleinkind() {
  const params = new URLSearchParams(window.location.search);
  kk.childId   = params.get('childId');
  kk.childName = params.get('childName') || 'Hallo';

  if (!kk.childId) { window.location.href = '/parent'; return; }

  // Pick a random mascot
  kk.mascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];
  document.getElementById('kk-mascot').textContent = kk.mascot;
  document.querySelector('.kk-loading__mascot').textContent = kk.mascot;

  // Set child name greeting
  document.getElementById('kk-child-name').textContent = `Hallo ${kk.childName}! 👋`;

  // Exit button → back to parent dashboard
  document.getElementById('exit-btn').addEventListener('click', () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    window.location.href = '/parent';
  });
  document.getElementById('lesson-back-btn').addEventListener('click', () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    showScreen('home');
  });
  document.getElementById('win-next-btn').addEventListener('click', () => {
    if (kk.currentSubject) startLesson(kk.currentSubject);
  });
  document.getElementById('win-home-btn').addEventListener('click', () => {
    showScreen('home');
  });

  await loadSubjects();
  hideLoading();
  greetChild();
}

/* ─── Screens ─── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  window.scrollTo(0, 0);
}

function hideLoading() {
  document.getElementById('kk-loading').classList.add('hidden');
}

/* ─── Load child's subjects ─── */
async function loadSubjects() {
  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-subjects', userId: kk.childId })
    });
    const data = await res.json();
    kk.subjects = (data.subjects || []).filter(s => s.isCore);
  } catch {
    kk.subjects = [];
  }

  // Fallback if no subjects configured
  if (kk.subjects.length === 0) {
    kk.subjects = [
      { id: 'tiere',      name: 'Tiere',       emoji: '🐘' },
      { id: 'farben',     name: 'Farben',      emoji: '🎨' },
      { id: 'zahlen',     name: 'Zahlen',      emoji: '🔢' },
      { id: 'buchstaben', name: 'Buchstaben',  emoji: '🔤' },
    ];
  }

  renderSubjectGrid();
}

/* ─── Subject Grid ─── */
const CARD_COLORS = [
  { border: '#ff8c42', bg: 'linear-gradient(145deg,#fff8f2,#fff)' },
  { border: '#a78bfa', bg: 'linear-gradient(145deg,#f5f3ff,#fff)' },
  { border: '#34d399', bg: 'linear-gradient(145deg,#f0fdf8,#fff)' },
  { border: '#60a5fa', bg: 'linear-gradient(145deg,#eff6ff,#fff)' },
  { border: '#f472b6', bg: 'linear-gradient(145deg,#fdf2f8,#fff)' },
  { border: '#facc15', bg: 'linear-gradient(145deg,#fefce8,#fff)' },
];

function renderSubjectGrid() {
  const grid = document.getElementById('kk-subject-grid');
  grid.innerHTML = kk.subjects.map((s, i) => {
    const col = CARD_COLORS[i % CARD_COLORS.length];
    return `
      <div class="kk-subject-card"
           style="border-color:${col.border};background:${col.bg}"
           onclick="startLesson(${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <span class="kk-subject-card__emoji">${s.emoji || '📚'}</span>
        <div class="kk-subject-card__name">${s.name}</div>
        <div class="kk-subject-card__stars">${'⭐'.repeat(Math.min(3, Math.floor(Math.random() * 4)))}</div>
      </div>`;
  }).join('');
}

/* ─── Start Lesson ─── */
async function startLesson(subject) {
  kk.currentSubject = subject;
  kk.quizAnswered   = false;
  kk.sentenceIndex  = 0;

  showScreen('lesson');
  showLoadingLesson();

  try {
    const res  = await fetch('/api/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode:        'kleinkind',
        subjectName: subject.name,
        lessonTitle: subject.name,
        userId:      kk.childId
      })
    });
    const data = await res.json();
    if (!data.title) throw new Error('No data');
    kk.currentLesson = data;
    renderLesson(data);
  } catch {
    // Fallback lesson
    kk.currentLesson = {
      title: subject.name,
      emoji: subject.emoji || '📚',
      sentences: ['Das macht Spaß!', 'Wir lernen heute etwas Tolles.', 'Du schaffst das!'],
      question:  'Was macht Spaß?',
      answers: [
        { emoji: '📚', label: 'Lernen',   correct: true  },
        { emoji: '😴', label: 'Schlafen', correct: false },
        { emoji: '🌧️', label: 'Regen',    correct: false },
        { emoji: '😢', label: 'Weinen',   correct: false },
      ],
      praise: 'Super gemacht! 🎉'
    };
    renderLesson(kk.currentLesson);
  }
}

function showLoadingLesson() {
  document.getElementById('lesson-emoji').textContent  = '⏳';
  document.getElementById('lesson-title').textContent  = 'Gleich…';
  document.getElementById('lesson-sentences').innerHTML = `
    <div style="text-align:center;padding:40px 0;font-size:3rem;animation:mascot-bounce 1s ease-in-out infinite">${kk.mascot}</div>`;
  document.getElementById('lesson-quiz').innerHTML = '';
  document.getElementById('kk-dots').innerHTML = '';
}

function renderLesson(data) {
  // Header
  document.getElementById('lesson-emoji').textContent = data.emoji || '📚';
  document.getElementById('lesson-title').textContent = data.title || '';

  // Progress dots
  const dots = document.getElementById('kk-dots');
  dots.innerHTML = data.sentences.map((_, i) =>
    `<div class="kk-dot ${i === 0 ? 'active' : ''}"></div>`
  ).join('');

  // Sentences
  const sentBox = document.getElementById('lesson-sentences');
  sentBox.innerHTML = data.sentences.map((s, i) => `
    <div class="kk-sentence-card" id="sent-${i}" onclick="speakSentence(${i})">
      <div class="kk-sentence-card__play" id="play-${i}">🔊</div>
      <div class="kk-sentence-card__text">${s}</div>
    </div>`).join('');

  // Quiz
  const quizBox = document.getElementById('lesson-quiz');
  quizBox.innerHTML = `
    <div class="kk-quiz-question" id="kk-question" onclick="speakText('${escQ(data.question)}')">${data.question}</div>
    <div class="kk-answers-grid" id="kk-answers">
      ${shuffleAnswers(data.answers).map((a, i) => `
        <div class="kk-answer-btn" id="ans-${i}" onclick="checkAnswer(this, ${a.correct}, '${escQ(data.praise)}', '${escQ(a.label)}')">
          <span class="kk-answer-btn__emoji">${a.emoji}</span>
          <span class="kk-answer-btn__label">${a.label}</span>
        </div>`).join('')}
    </div>`;

  // Auto-play first sentence after short delay
  setTimeout(() => {
    speakSentence(0);
  }, 500);
}

function escQ(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function shuffleAnswers(answers) {
  const arr = [...answers];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ─── TTS ─── */
function speak(text, onEnd) {
  if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = 'de-DE';
  utt.rate  = 0.82;
  utt.pitch = 1.1;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

function speakText(text) { speak(text); }

function speakSentence(index) {
  const data = kk.currentLesson;
  if (!data) return;

  // Update dots
  document.querySelectorAll('.kk-dot').forEach((d, i) => {
    d.className = 'kk-dot' + (i < index ? ' done' : i === index ? ' active' : '');
  });

  // Reset all play buttons
  document.querySelectorAll('.kk-sentence-card__play').forEach(p => {
    p.classList.remove('playing');
    p.textContent = '🔊';
  });

  const playBtn = document.getElementById(`play-${index}`);
  if (playBtn) { playBtn.classList.add('playing'); playBtn.textContent = '🔈'; }

  // Mascot talking
  const mascotEl = document.getElementById('kk-mascot');
  if (mascotEl) mascotEl.classList.add('talking');

  speak(data.sentences[index], () => {
    if (playBtn) { playBtn.classList.remove('playing'); playBtn.textContent = '🔊'; }
    if (mascotEl) mascotEl.classList.remove('talking');
    // Update dot to done
    const dot = document.querySelectorAll('.kk-dot')[index];
    if (dot) dot.classList.replace('active', 'done');

    // Auto-play next sentence
    kk.sentenceIndex = index + 1;
    if (kk.sentenceIndex < data.sentences.length) {
      setTimeout(() => speakSentence(kk.sentenceIndex), 400);
    } else {
      // All sentences done — read the question
      setTimeout(() => speakText(data.question), 600);
    }
  });
}

/* ─── Quiz ─── */
function checkAnswer(el, correct, praise, label) {
  if (kk.quizAnswered) return;

  if (correct) {
    kk.quizAnswered = true;
    el.classList.add('kk-answer-btn--correct');
    // Disable other answers
    document.querySelectorAll('.kk-answer-btn').forEach(b => b.style.pointerEvents = 'none');

    kk.sessionStars++;
    kk.lessonsToday++;
    updateStars();

    speak(praise || 'Super gemacht! Richtig!', () => {
      setTimeout(() => showWin(praise), 400);
    });
  } else {
    el.classList.add('kk-answer-btn--wrong');
    speak('Noch mal versuchen!');
    setTimeout(() => el.classList.remove('kk-answer-btn--wrong'), 600);
  }
}

function updateStars() {
  const stars = '⭐'.repeat(Math.min(kk.sessionStars, 9));
  document.getElementById('kk-stars').textContent = stars || '⭐';
}

/* ─── Win Screen ─── */
function showWin(praise) {
  document.getElementById('win-praise').textContent  = praise || 'Super gemacht! 🎉';
  document.getElementById('win-stars').textContent   = '⭐'.repeat(Math.min(kk.sessionStars, 5));
  showScreen('win');
  speak('Super gemacht! Du bist toll! Möchtest du noch eine Aufgabe?');
}

/* ─── Greeting ─── */
function greetChild() {
  const greetings = [
    `Hallo ${kk.childName}! Was möchtest du heute lernen?`,
    `Super, ${kk.childName} ist da! Worüber wollen wir heute mehr wissen?`,
    `${kk.childName}, wähle ein Bild aus und wir lernen zusammen!`,
  ];
  const text = greetings[Math.floor(Math.random() * greetings.length)];
  const mascotEl = document.getElementById('kk-mascot');
  if (mascotEl) mascotEl.classList.add('talking');
  speak(text, () => {
    if (mascotEl) mascotEl.classList.remove('talking');
  });
}
