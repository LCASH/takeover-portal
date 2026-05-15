(function () {
  // Portal dashboard: shows application status for returning users who log in.
  // Onboarding form has been moved to the signup flow (index.html Step 2).
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    document.getElementById('loadingEl').innerHTML = 'Portal is not configured.';
    return;
  }
  const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

  const loadingEl = document.getElementById('loadingEl');
  const accessDeniedEl = document.getElementById('accessDeniedEl');
  const thanksEl = document.getElementById('thanksEl');
  const statusLabel = document.getElementById('statusLabel');
  const statusSubtext = document.getElementById('statusSubtext');
  const confirmedLine = document.getElementById('confirmedLine');
  const signOutLink = document.getElementById('signOutLink');
  const telegramLink = document.getElementById('telegramLink');
  const telegramCard = document.getElementById('telegramCard');

  let bowler = null;

  function statusCopy(status) {
    if (status === 'confirmed') return { label: 'Approved', subtext: "You're all set. We'll be in touch with next steps." };
    if (status === 'unqualified') return { label: 'Not approved', subtext: 'Your application was not approved. Contact us if you have questions.' };
    return { label: 'Pending review', subtext: "We're checking your details. We'll be in touch within 24 hours." };
  }

  function showDashboard(b) {
    if (!thanksEl) return;
    bowler = b;
    var status = (b && b.status) ? b.status : 'onboarding_submitted';
    var copy = statusCopy(status);
    var statusCard = document.getElementById('statusCard');
    if (statusCard) {
      statusCard.classList.remove('status-approved', 'status-not-approved');
      if (status === 'confirmed') statusCard.classList.add('status-approved');
      else if (status === 'unqualified') statusCard.classList.add('status-not-approved');
    }
    if (statusLabel) statusLabel.textContent = copy.label;
    if (statusSubtext) statusSubtext.textContent = copy.subtext;
    if (confirmedLine) {
      confirmedLine.hidden = status !== 'confirmed';
      confirmedLine.classList.toggle('hidden', status !== 'confirmed');
    }
    var tgUrl = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.telegramInviteUrl) || '';
    if (telegramLink) telegramLink.href = tgUrl || '#';
    if (telegramCard) telegramCard.style.display = tgUrl ? '' : 'none';
    thanksEl.hidden = false;
  }

  async function init() {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      loadingEl.hidden = true;
      accessDeniedEl.hidden = false;
      accessDeniedEl.querySelector('a').href = 'login.html';
      return;
    }
    var userId = session.user.id;

    var { data: b, error } = await supabase
      .from('bowlers')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (error || !b) {
      loadingEl.hidden = true;
      accessDeniedEl.hidden = false;
      return;
    }
    if (!b.login_enabled_at) {
      loadingEl.hidden = true;
      accessDeniedEl.hidden = false;
      return;
    }
    bowler = b;

    loadingEl.hidden = true;
    showDashboard(bowler);

    signOutLink.addEventListener('click', async function (e) {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    });
  }

  init();
})();
