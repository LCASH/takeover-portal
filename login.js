(function () {
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    var msg = 'Portal is not configured. ';
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      msg += 'Create a .env with SUPABASE_URL and SUPABASE_ANON_KEY, then run: npm run build && npm run serve';
    } else {
      msg += 'In Vercel (or your host), set Environment Variables: SUPABASE_URL and SUPABASE_ANON_KEY (same as TAKEOVER), then redeploy.';
    }
    document.getElementById('loginError').textContent = msg;
    document.getElementById('loginError').hidden = false;
    return;
  }
  const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    var password = form.querySelector('[name="password"]').value;

    var btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    try {
      var { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        var msg = authError.message || 'Sign in failed.';
        if (authError.message && authError.message.toLowerCase().includes('invalid login')) {
          msg = 'Invalid email or password. Use the exact email and password from your login message.';
        }
        showError(msg);
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return;
      }
      var userId = authData.user?.id;
      if (!userId) {
        showError('Sign in failed.');
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return;
      }
      var { data: bowler, error: bowlerError } = await supabase
        .from('bowlers')
        .select('id, login_enabled_at')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (bowlerError) {
        await supabase.auth.signOut();
        showError('Could not verify your account.');
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return;
      }
      if (!bowler || !bowler.login_enabled_at) {
        await supabase.auth.signOut();
        showError('Your account is not yet enabled for portal access. We will reach out when you can log in.');
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return;
      }
      window.location.href = window.location.origin + '/portal.html';
    } catch (err) {
      showError(err.message || 'Something went wrong.');
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
  });
})();
