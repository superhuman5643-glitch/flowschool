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
  if (session) {
    await redirectByRole(sb);
    return;
  }

  // Role selector
  let selectedRole = 'lenny';
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedRole = btn.dataset.role;
      if (btn.dataset.email) document.getElementById('email').value = btn.dataset.email;
      if (btn.dataset.pw)    document.getElementById('password').value = btn.dataset.pw;
    });
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    setLoginLoading(true);
    hideError();

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showError('Anmeldung fehlgeschlagen: ' + error.message);
      setLoginLoading(false);
      return;
    }
    await redirectByRole(sb);
  });

  // Sign up link
  document.getElementById('signup-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { showError('Bitte E-Mail und Passwort eingeben.'); return; }
    setLoginLoading(true);

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { showError(error.message); setLoginLoading(false); return; }

    // Create user profile
    if (data.user) {
      await sb.from('users').insert({ id: data.user.id, email, role: selectedRole });
    }
    showError('Bestätigungs-E-Mail wurde gesendet! Dann hier anmelden.');
    setLoginLoading(false);
  });
}

async function redirectByRole(sb) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role || 'lenny';
  window.location.href = role === 'parent' ? '/parent' : '/home';
}

function setLoginLoading(on) {
  document.getElementById('login-btn').disabled = on;
  document.getElementById('login-btn-text').textContent = on ? 'Laden…' : 'Anmelden';
  document.getElementById('login-spinner').classList.toggle('hidden', !on);
}
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideError() {
  document.getElementById('error-msg').classList.remove('visible');
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
  const sb = await getSupabase();
  await sb.auth.signOut();
  window.location.href = '/';
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
