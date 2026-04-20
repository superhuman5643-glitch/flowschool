/* ── FlowSchool — Auth & Supabase client ── */

let _supabase = null;
let _config   = null;

async function getConfig() {
  if (_config) return _config;
  const res = await fetch('/api/config');
  _config = await res.json();
  return _config;
}

async function getSupabase() {
  if (_supabase) return _supabase;
  const cfg = await getConfig();
  _supabase = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return _supabase;
}

/* ─── Login page ─── */
async function initLogin() {
  const sb = await getSupabase();
  hideLoader();

  // If already logged in, redirect
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await redirectByRole(sb); return; }

  // ── Tab switching ──
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('view-login').style.display = '';
    document.getElementById('view-register').style.display = 'none';
    hideError(); hideSuccess();
  });
  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('view-register').style.display = '';
    document.getElementById('view-login').style.display = 'none';
    hideError(); hideSuccess();
  });

  // ── Login role selector (quick-fill) ──
  document.querySelectorAll('#view-login .role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-login .role-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (btn.dataset.email) document.getElementById('email').value = btn.dataset.email;
      if (btn.dataset.pw)    document.getElementById('password').value = btn.dataset.pw;
    });
  });

  // ── Login form ──
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    setLoading('login', true); hideError();

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { showError('Anmeldung fehlgeschlagen: ' + error.message); setLoading('login', false); return; }
    await redirectByRole(sb);
  });

  // ── Register role selector ──
  let regRole = 'lenny';
  document.querySelectorAll('#reg-role-selector .role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#reg-role-selector .role-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      regRole = btn.dataset.role;
    });
  });

  // ── Register form ──
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    setLoading('register', true); hideError(); hideSuccess();

    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { display_name: name } }
    });
    if (error) { showError(error.message); setLoading('register', false); return; }

    if (data.user) {
      await sb.from('users').insert({ id: data.user.id, email, role: regRole }).catch(() => {});
    }

    setLoading('register', false);
    if (data.session) {
      // Email confirmation disabled — log in directly
      await redirectByRole(sb);
    } else {
      showSuccess('✅ Konto erstellt! Bitte E-Mail bestätigen und dann anmelden.');
      document.getElementById('register-form').reset();
    }
  });
}

async function redirectByRole(sb) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role || 'lenny';
  window.location.href = role === 'parent' ? '/parent' : '/home';
}

function setLoading(type, on) {
  if (type === 'login') {
    document.getElementById('login-btn').disabled = on;
    document.getElementById('login-btn-text').textContent = on ? 'Laden…' : 'Anmelden';
    document.getElementById('login-spinner').classList.toggle('hidden', !on);
  } else {
    document.getElementById('register-btn').disabled = on;
    document.getElementById('register-btn-text').textContent = on ? 'Laden…' : 'Konto erstellen';
    document.getElementById('register-spinner').classList.toggle('hidden', !on);
  }
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg; el.classList.add('visible');
}
function hideError() {
  document.getElementById('error-msg').classList.remove('visible');
}
function showSuccess(msg) {
  const el = document.getElementById('success-msg');
  el.textContent = msg; el.classList.add('visible');
}
function hideSuccess() {
  document.getElementById('success-msg').classList.remove('visible');
}

/* ─── Auth guard (used by home/lesson/parent) ─── */
async function requireAuth(requiredRole) {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();

  if (!session) { window.location.href = '/'; return null; }

  const { data: profile } = await sb.from('users').select('*').eq('id', session.user.id).single();
  if (!profile) { window.location.href = '/'; return null; }

  if (requiredRole && profile.role !== requiredRole) {
    window.location.href = profile.role === 'parent' ? '/parent' : '/home';
    return null;
  }
  return { sb, user: session.user, profile };
}

/* ─── Logout ─── */
async function logout() {
  try {
    const sb = await getSupabase();
    await sb.auth.signOut();
  } catch {}
  // Clear any cached session state
  _supabase = null;
  localStorage.clear();
  window.location.replace('/');
}

/* ─── Page loader ─── */
function hideLoader() {
  const el = document.getElementById('page-loader');
  if (el) { el.classList.add('hidden'); }
}

/* ─── Toast ─── */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}
