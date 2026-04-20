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

  // ── Role picked by user (set in step 1) ──
  let selectedRole = 'lenny'; // default

  // ── Helper: show auth form for a given role ──
  function showAuthView(role) {
    selectedRole = role;
    const isParent = role === 'parent';
    const label    = isParent ? '👨‍💼 Elternteil' : '🧑‍🚀 Kind';

    document.getElementById('view-role-pick').style.display = 'none';
    document.getElementById('view-auth').style.display      = '';
    document.getElementById('login-role-badge').textContent    = label;
    document.getElementById('register-role-badge').textContent = label;

    // Reset to login tab
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('view-login').style.display    = '';
    document.getElementById('view-register').style.display = 'none';
    hideError(); hideSuccess();
    document.getElementById('email').focus();
  }

  function showRolePick() {
    document.getElementById('view-auth').style.display      = 'none';
    document.getElementById('view-role-pick').style.display = '';
    hideError(); hideSuccess();
  }

  // ── Step 1: Role pick ──
  document.getElementById('pick-child').addEventListener('click',  () => showAuthView('lenny'));
  document.getElementById('pick-parent').addEventListener('click', () => showAuthView('parent'));

  // ── Back buttons ──
  document.getElementById('back-from-login').addEventListener('click',    showRolePick);
  document.getElementById('back-from-register').addEventListener('click', showRolePick);

  // ── Tab switching ──
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('view-login').style.display    = '';
    document.getElementById('view-register').style.display = 'none';
    hideError(); hideSuccess();
  });
  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('view-register').style.display = '';
    document.getElementById('view-login').style.display    = 'none';
    hideError(); hideSuccess();
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
      // Use server-side API (service role) to avoid RLS issues
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', userId: data.user.id, email, role: selectedRole })
      }).catch(() => {});
    }

    setLoading('register', false);
    // Show success, switch to login tab
    showSuccess('✅ Konto erstellt! Jetzt anmelden.');
    document.getElementById('register-form').reset();
    setTimeout(() => {
      document.getElementById('tab-login').click();
    }, 1500);
  });
}

async function redirectByRole(sb) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: profile, error } = await sb.from('users').select('role').eq('id', user.id).maybeSingle();
  if (!profile) {
    // Profile not ready yet (e.g. server insert in progress) — retry once after short delay
    await new Promise(r => setTimeout(r, 800));
    const { data: profile2 } = await sb.from('users').select('role').eq('id', user.id).maybeSingle();
    const role2 = profile2?.role || 'lenny';
    window.location.href = role2 === 'parent' ? '/parent' : '/home';
    return;
  }
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
  if (!profile) {
    // No profile = broken account state → sign out to prevent redirect loop
    await sb.auth.signOut();
    window.location.replace('/');
    return null;
  }

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
