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

  // --- Magic-link "Resume my application" flow ---
  // Sends a Supabase Auth OTP email. The user clicks the link, lands back on
  // index.html with auth tokens in the URL fragment; script.js's
  // tryResumeSession() then picks up the session and jumps to Step 2.
  var resumeForm = document.getElementById('resumeForm');
  var resumeMsg = document.getElementById('resumeMsg');
  var resumeBtn = document.getElementById('resumeBtn');
  if (resumeForm) {
    resumeForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (resumeMsg) { resumeMsg.hidden = true; resumeMsg.textContent = ''; resumeMsg.className = 'text-sm mt-3'; }
      var emailInput = resumeForm.querySelector('[name="resume_email"]');
      var email = (emailInput && emailInput.value || '').trim().toLowerCase();
      if (!email) return;
      if (resumeBtn) { resumeBtn.disabled = true; resumeBtn.textContent = 'Sending…'; }
      try {
        var redirectTo = window.location.origin + '/';
        var result = await supabase.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
        });
        if (result.error) {
          if (resumeMsg) {
            resumeMsg.hidden = false;
            resumeMsg.className = 'text-sm mt-3 text-red-600';
            // Common cause: shouldCreateUser:false + email not in auth.users.
            // Supabase returns "Signups not allowed for otp" — translate that.
            var msg = result.error.message || '';
            if (/signups not allowed/i.test(msg) || /not allowed for otp/i.test(msg)) {
              resumeMsg.textContent = 'We can\'t find an application with that email. Double-check the address you used at sign-up, or use the form at the home page to start over.';
            } else {
              resumeMsg.textContent = 'Could not send link: ' + msg;
            }
          }
        } else {
          if (resumeMsg) {
            resumeMsg.hidden = false;
            resumeMsg.className = 'text-sm mt-3 text-emerald-600';
            resumeMsg.textContent = 'Check your inbox — a sign-in link has been sent to ' + email + '. Open it on the device you want to finish on. The link is single-use and expires in 1 hour.';
          }
          resumeForm.reset();
        }
      } catch (err) {
        if (resumeMsg) {
          resumeMsg.hidden = false;
          resumeMsg.className = 'text-sm mt-3 text-red-600';
          resumeMsg.textContent = (err && err.message) || 'Something went wrong sending the link. Try again.';
        }
      } finally {
        if (resumeBtn) { resumeBtn.disabled = false; resumeBtn.textContent = 'Send me a sign-in link'; }
      }
    });
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
        showError('Your application is still being reviewed. We\'ll send you an SMS with your login details once approved.');
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
