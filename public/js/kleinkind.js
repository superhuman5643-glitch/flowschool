/* ── FlowSchool — Kleinkind-Modus ── */

const MASCOTS = ['🦁', '🐻', '🦊', '🐼', '🐨', '🐯'];
const CARD_COLORS = [
  { border: '#ff8c42', bg: 'linear-gradient(145deg,#fff8f2,#fff)' },
  { border: '#a78bfa', bg: 'linear-gradient(145deg,#f5f3ff,#fff)' },
  { border: '#34d399', bg: 'linear-gradient(145deg,#f0fdf8,#fff)' },
  { border: '#60a5fa', bg: 'linear-gradient(145deg,#eff6ff,#fff)' },
  { border: '#f472b6', bg: 'linear-gradient(145deg,#fdf2f8,#fff)' },
  { border: '#facc15', bg: 'linear-gradient(145deg,#fefce8,#fff)' },
];

let kk = {
  childId:        null,
  childName:      'Hallo',
  subjects:       [],
  currentSubject: null,
  currentLesson:  null,
  mascot:         '🦁',
  sentenceIndex:  0,
  quizAnswered:   false,
};

/* ════════════════════════════════════════
   INIT
════════════════════════════════════════ */
async function initKleinkind() {
  const params   = new URLSearchParams(window.location.search);
  kk.childId     = params.get('childId');
  kk.childName   = params.get('childName') || 'Hallo';
  if (!kk.childId) { window.location.href = '/parent'; return; }

  kk.mascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];
  document.getElementById('kk-mascot').textContent           = kk.mascot;
  document.querySelector('.kk-loading__mascot').textContent  = kk.mascot;
  document.getElementById('kk-child-name').textContent       = `Hallo ${kk.childName}! 👋`;

  document.getElementById('exit-btn').addEventListener('click', () => {
    window.speechSynthesis?.cancel();
    window.location.href = '/parent';
  });
  document.getElementById('lesson-back-btn').addEventListener('click', () => {
    window.speechSynthesis?.cancel();
    showScreen('home');
  });
  document.getElementById('win-next-btn').addEventListener('click', () => {
    if (kk.currentSubject) startLesson(kk.currentSubject);
  });
  document.getElementById('win-home-btn').addEventListener('click', () => showScreen('home'));

  updateStarsDisplay();
  await loadSubjects();
  hideLoading();
  greetChild();
}

/* ════════════════════════════════════════
   PERSISTENCE — localStorage helpers
════════════════════════════════════════ */
function starsKey()               { return `kk_stars_${kk.childId}`; }
function progressKey(subjectId)   { return `kk_prog_${kk.childId}_${subjectId}`; }
function shownKey(subjectId)      { return `kk_shown_${kk.childId}_${subjectId}`; }

function getTotalStars() {
  return parseInt(localStorage.getItem(starsKey()) || '0', 10);
}
function addStar() {
  const n = getTotalStars() + 1;
  localStorage.setItem(starsKey(), n);
  updateStarsDisplay();
  return n;
}
function updateStarsDisplay() {
  const total = getTotalStars();
  const display = total === 0 ? '⭐' : '⭐'.repeat(Math.min(total, 9));
  const el = document.getElementById('kk-stars');
  if (el) el.textContent = display;
}

function getProgress(subjectId) {
  return parseInt(localStorage.getItem(progressKey(subjectId)) || '0', 10);
}
function addProgress(subjectId) {
  const n = getProgress(subjectId) + 1;
  localStorage.setItem(progressKey(subjectId), n);
  return n;
}

function getShownTopics(subjectId) {
  try { return JSON.parse(localStorage.getItem(shownKey(subjectId)) || '[]'); }
  catch { return []; }
}
function addShownTopic(subjectId, title) {
  const topics = getShownTopics(subjectId);
  if (!topics.includes(title)) {
    topics.push(title);
    if (topics.length > 30) topics.shift(); // keep last 30
    localStorage.setItem(shownKey(subjectId), JSON.stringify(topics));
  }
}

/* ════════════════════════════════════════
   SCREENS
════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'home') renderSubjectGrid(); // refresh progress
}
function hideLoading() {
  document.getElementById('kk-loading').classList.add('hidden');
}

/* ════════════════════════════════════════
   SUBJECTS
════════════════════════════════════════ */
async function loadSubjects() {
  try {
    const res  = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list-subjects', userId: kk.childId })
    });
    const data = await res.json();
    kk.subjects = (data.subjects || []).filter(s => s.isCore);
  } catch { kk.subjects = []; }

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

function renderSubjectGrid() {
  const grid = document.getElementById('kk-subject-grid');
  grid.innerHTML = kk.subjects.map((s, i) => {
    const col     = CARD_COLORS[i % CARD_COLORS.length];
    const count   = getProgress(s.id);
    const stars   = count > 0 ? '⭐'.repeat(Math.min(count, 5)) : '☆☆☆☆☆';
    const badge   = count > 0 ? `<div class="kk-subject-count">${count} ×</div>` : '';
    return `
      <div class="kk-subject-card"
           style="border-color:${col.border};background:${col.bg}"
           onclick="startLesson(${JSON.stringify(s).replace(/"/g, '&quot;')})">
        ${badge}
        <span class="kk-subject-card__emoji">${s.emoji || '📚'}</span>
        <div class="kk-subject-card__name">${s.name}</div>
        <div class="kk-subject-card__stars">${stars}</div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════
   IMAGE FETCH — Wikipedia REST + Twemoji fallback
════════════════════════════════════════ */

// Wikipedia REST API — much better coverage than the action API
async function fetchWikipediaImage(term) {
  if (!term) return null;
  try {
    const slug = encodeURIComponent(term.trim().toLowerCase().replace(/\s+/g, '_'));
    const res  = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.thumbnail?.source || data?.originalimage?.source || null;
  } catch { return null; }
}

// Twemoji SVG — crisp, colorful illustration fallback for any emoji
function twemojiUrl(emoji) {
  if (!emoji) return null;
  try {
    const cp = [...emoji][0].codePointAt(0).toString(16);
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`;
  } catch { return null; }
}

// Fetch real photo; fall back to Twemoji SVG
async function fetchImage(term, fallbackEmoji) {
  const photo = await fetchWikipediaImage(term);
  if (photo) return { src: photo, isTwemoji: false };
  const tw = twemojiUrl(fallbackEmoji);
  return tw ? { src: tw, isTwemoji: true } : null;
}

async function fetchAllImages(mainTerm, mainEmoji, answers) {
  const [mainImg, ...ansImgs] = await Promise.all([
    fetchImage(mainTerm, mainEmoji),
    ...answers.map(a => fetchImage(a.imageSearch || a.label, a.emoji))
  ]);
  return {
    mainImg,
    answers: answers.map((a, i) => ({ ...a, img: ansImgs[i] }))
  };
}

/* ════════════════════════════════════════
   LESSON
════════════════════════════════════════ */
async function startLesson(subject) {
  kk.currentSubject = subject;
  kk.quizAnswered   = false;
  kk.sentenceIndex  = 0;
  showScreen('lesson');
  showLoadingLesson();

  const shownTopics = getShownTopics(subject.id);

  try {
    const res  = await fetch('/api/generate-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode:        'kleinkind',
        subjectName: subject.name,
        lessonTitle: subject.name,
        userId:      kk.childId,
        shownTopics
      })
    });
    const data = await res.json();
    if (!data.title) throw new Error('No data');
    kk.currentLesson = data;

    // Track this topic so it won't repeat
    addShownTopic(subject.id, data.title);

    await renderLesson(data);
  } catch {
    // Fallback
    kk.currentLesson = {
      title: subject.name, emoji: subject.emoji || '📚',
      imageSearch: subject.name,
      sentences: ['Das macht Spaß!', 'Wir lernen heute etwas Tolles.', 'Du schaffst das!'],
      question:  'Was macht Spaß?',
      answers: [
        { emoji: '📚', label: 'Lernen',   imageSearch: 'book',    correct: true  },
        { emoji: '😴', label: 'Schlafen', imageSearch: 'sleep',   correct: false },
        { emoji: '🌧️', label: 'Regen',   imageSearch: 'rain',    correct: false },
        { emoji: '😢', label: 'Weinen',   imageSearch: 'crying',  correct: false },
      ],
      praise: 'Super gemacht! 🎉'
    };
    await renderLesson(kk.currentLesson);
  }
}

function showLoadingLesson() {
  document.getElementById('lesson-emoji').textContent   = '⏳';
  document.getElementById('lesson-title').textContent   = 'Gleich…';
  document.getElementById('lesson-sentences').innerHTML = `
    <div class="kk-photo-skeleton"></div>
    <div style="text-align:center;padding:24px 0;font-size:3rem;animation:mascot-bounce 1s ease-in-out infinite">${kk.mascot}</div>`;
  document.getElementById('lesson-quiz').innerHTML = '';
  document.getElementById('kk-dots').innerHTML     = '';
}

async function renderLesson(data) {
  document.getElementById('lesson-emoji').textContent = data.emoji || '📚';
  document.getElementById('lesson-title').textContent = data.title || '';

  // Progress dots
  document.getElementById('kk-dots').innerHTML = data.sentences.map((_, i) =>
    `<div class="kk-dot ${i === 0 ? 'active' : ''}"></div>`
  ).join('');

  // Fetch all images in parallel (Wikipedia + Twemoji fallback)
  const shuffled = shuffleAnswers(data.answers);
  const { mainImg, answers: answersWithImgs } = await fetchAllImages(
    data.imageSearch, data.emoji, shuffled
  );

  // Main image
  const sentBox = document.getElementById('lesson-sentences');
  const mainImgHtml = mainImg
    ? `<img class="kk-main-photo${mainImg.isTwemoji ? ' kk-main-photo--twemoji' : ''}"
            src="${mainImg.src}" alt="${data.title}"
            onerror="this.style.display='none'" />`
    : `<div class="kk-main-photo-emoji">${data.emoji}</div>`;

  sentBox.innerHTML = `
    <div class="kk-main-photo-wrap">${mainImgHtml}</div>
    ${data.sentences.map((s, i) => `
      <div class="kk-sentence-card" onclick="speakSentence(${i})">
        <div class="kk-sentence-card__play" id="play-${i}">🔊</div>
        <div class="kk-sentence-card__text">${s}</div>
      </div>`).join('')}`;

  // Quiz with images
  document.getElementById('lesson-quiz').innerHTML = `
    <div class="kk-quiz-question" onclick="speakText('${escQ(data.question)}')">${data.question} 🤔</div>
    <div class="kk-answers-grid">
      ${answersWithImgs.map((a, i) => `
        <div class="kk-answer-btn" id="ans-${i}"
             onclick="checkAnswer(this, ${a.correct}, '${escQ(data.praise)}', '${escQ(a.label)}')">
          ${a.img
            ? `<img class="kk-answer-photo${a.img.isTwemoji ? ' kk-answer-photo--twemoji' : ''}"
                    src="${a.img.src}" alt="${a.label}"
                    onerror="this.style.display='none'" />`
            : `<span class="kk-answer-btn__emoji">${a.emoji}</span>`}
          <span class="kk-answer-btn__label">${a.label}</span>
        </div>`).join('')}
    </div>`;

  setTimeout(() => speakSentence(0), 400);
}

function escQ(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
function shuffleAnswers(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ════════════════════════════════════════
   TTS
════════════════════════════════════════ */
function speak(text, onEnd) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const utt   = new SpeechSynthesisUtterance(text);
  utt.lang    = 'de-DE';
  utt.rate    = 0.82;
  utt.pitch   = 1.1;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}
function speakText(text) { speak(text); }

function speakSentence(index) {
  const data = kk.currentLesson;
  if (!data) return;

  document.querySelectorAll('.kk-dot').forEach((d, i) => {
    d.className = 'kk-dot' + (i < index ? ' done' : i === index ? ' active' : '');
  });
  document.querySelectorAll('.kk-sentence-card__play').forEach(p => {
    p.classList.remove('playing'); p.textContent = '🔊';
  });
  const playBtn   = document.getElementById(`play-${index}`);
  const mascotEl  = document.getElementById('kk-mascot');
  if (playBtn)   { playBtn.classList.add('playing');  playBtn.textContent = '🔈'; }
  if (mascotEl)    mascotEl.classList.add('talking');

  speak(data.sentences[index], () => {
    if (playBtn)  { playBtn.classList.remove('playing'); playBtn.textContent = '🔊'; }
    if (mascotEl)   mascotEl.classList.remove('talking');
    document.querySelectorAll('.kk-dot')[index]?.classList.replace('active', 'done');

    kk.sentenceIndex = index + 1;
    if (kk.sentenceIndex < data.sentences.length) {
      setTimeout(() => speakSentence(kk.sentenceIndex), 400);
    } else {
      setTimeout(() => speakText(data.question), 600);
    }
  });
}

/* ════════════════════════════════════════
   KONFETTI ANIMATION
════════════════════════════════════════ */
function launchConfetti(big = false) {
  const existing = document.getElementById('kk-confetti');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'kk-confetti';
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(wrap);

  const colors  = ['#ff8c42','#ffcc6a','#7c6aff','#34d399','#ff6a9e','#60a5fa','#fff','#f87171'];
  const count   = big ? 120 : 60;

  for (let i = 0; i < count; i++) {
    const el      = document.createElement('div');
    const size    = Math.random() * 14 + 6;
    const color   = colors[Math.floor(Math.random() * colors.length)];
    const startX  = Math.random() * 110 - 5;
    const delay   = Math.random() * 0.6;
    const dur     = Math.random() * 1.8 + 1.4;
    const rotEnd  = Math.random() * 900 - 450;
    const driftX  = (Math.random() - 0.5) * 200;

    el.style.cssText = `
      position:absolute;
      top:-${size * 2}px;
      left:${startX}%;
      width:${size}px;
      height:${size * (Math.random() > 0.5 ? 1 : 0.5)}px;
      background:${color};
      border-radius:${Math.random() > 0.4 ? '50%' : '2px'};
      animation: kk-fall ${dur}s ease-in ${delay}s forwards;
      --drift: ${driftX}px;
      --rot: ${rotEnd}deg;
    `;
    wrap.appendChild(el);
  }

  // Big stars burst for milestones
  if (big) {
    ['⭐','🌟','✨','🎉','🎊'].forEach((em, i) => {
      const s = document.createElement('div');
      s.textContent = em;
      s.style.cssText = `
        position:absolute;
        font-size:${Math.random()*28+20}px;
        top:-40px;
        left:${15 + i * 18}%;
        animation: kk-fall ${1.8 + i*0.2}s ease-in ${i*0.12}s forwards;
        --drift:${(Math.random()-0.5)*150}px;
        --rot:${Math.random()*360}deg;
      `;
      wrap.appendChild(s);
    });
  }

  setTimeout(() => wrap.remove(), 4000);
}

/* ════════════════════════════════════════
   QUIZ
════════════════════════════════════════ */
function checkAnswer(el, correct, praise, label) {
  if (kk.quizAnswered) return;

  if (correct) {
    kk.quizAnswered = true;
    el.classList.add('kk-answer-btn--correct');
    document.querySelectorAll('.kk-answer-btn').forEach(b => b.style.pointerEvents = 'none');

    const total   = addStar();
    addProgress(kk.currentSubject?.id);

    const isMilestone = total % 5 === 0;
    launchConfetti(isMilestone);

    let celebText = praise || 'Super gemacht!';
    if (total % 10 === 0) celebText = `Wahnsinn! ${total} Sterne! Du bist ein Superstar!`;
    else if (total % 5 === 0) celebText = `${total} Sterne! Fantastisch!`;

    speak(celebText, () => setTimeout(() => showWin(celebText, total), 300));
  } else {
    el.classList.add('kk-answer-btn--wrong');
    speak('Noch mal versuchen!');
    setTimeout(() => el.classList.remove('kk-answer-btn--wrong'), 600);
  }
}

/* ════════════════════════════════════════
   WIN SCREEN
════════════════════════════════════════ */
function showWin(praise, totalStars) {
  const total = totalStars || getTotalStars();
  const stars = Math.min(total, 9);
  document.getElementById('win-praise').textContent = praise || 'Super gemacht! 🎉';
  document.getElementById('win-stars').textContent  = '⭐'.repeat(stars);
  const totalEl = document.getElementById('win-total');
  if (totalEl) totalEl.textContent = `Gesamt: ${getTotalStars()} ⭐ gesammelt`;
  showScreen('win');
  // Konfetti auf dem Win-Screen nochmal!
  setTimeout(() => launchConfetti(total % 5 === 0), 200);
}

/* ════════════════════════════════════════
   GREETING
════════════════════════════════════════ */
function greetChild() {
  const total = getTotalStars();
  const greetings = total > 0
    ? [
        `Hallo ${kk.childName}! Du hast schon ${total} Sterne! Weiter so!`,
        `${kk.childName}, toll dass du wieder da bist! Auf geht's!`,
      ]
    : [
        `Hallo ${kk.childName}! Was möchtest du heute lernen?`,
        `${kk.childName}, wähle ein Bild — wir lernen zusammen!`,
      ];
  const text    = greetings[Math.floor(Math.random() * greetings.length)];
  const mascot  = document.getElementById('kk-mascot');
  mascot?.classList.add('talking');
  speak(text, () => mascot?.classList.remove('talking'));
}
