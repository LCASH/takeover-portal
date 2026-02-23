(function () {
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
  const accountEl = document.getElementById('accountEl');
  const detailsForm = document.getElementById('detailsForm');
  const endPartnershipForm = document.getElementById('endPartnershipForm');
  const formMessage = document.getElementById('formMessage');
  const endPartnershipDone = document.getElementById('endPartnershipDone');

  let bowler = null;

  function showMessage(msg, isError) {
    formMessage.textContent = msg;
    formMessage.className = 'text-sm mb-4 ' + (isError ? 'text-red-400' : 'text-[#7cfc00]');
    formMessage.hidden = false;
  }
  function hideMessage() {
    formMessage.hidden = true;
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
    accountEl.hidden = false;

    // Prefill edit form
    if (bowler.date_of_birth) detailsForm.querySelector('[name="date_of_birth"]').value = bowler.date_of_birth;
    if (bowler.address) detailsForm.querySelector('[name="address"]').value = bowler.address;
    if (bowler.referrer) detailsForm.querySelector('[name="referrer"]').value = bowler.referrer;
    if (bowler.previous_betting_accounts) detailsForm.querySelector('[name="previous_betting_accounts"]').value = bowler.previous_betting_accounts;

    // If they already requested to end partnership, show message and disable form
    if (bowler.end_partnership_requested_at) {
      endPartnershipDone.hidden = false;
      endPartnershipForm.querySelector('button[type="submit"]').disabled = true;
      endPartnershipForm.querySelector('textarea').disabled = true;
    }

    // Sign out
    document.getElementById('signOutLink').addEventListener('click', async function (e) {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    });
  }

  detailsForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideMessage();
    if (!bowler) return;
    var btn = detailsForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var payload = {
      date_of_birth: detailsForm.querySelector('[name="date_of_birth"]').value || null,
      address: detailsForm.querySelector('[name="address"]').value || null,
      referrer: detailsForm.querySelector('[name="referrer"]').value || null,
      previous_betting_accounts: detailsForm.querySelector('[name="previous_betting_accounts"]').value || null,
      updated_at: new Date().toISOString(),
    };
    var { error } = await supabase.from('bowlers').update(payload).eq('id', bowler.id);
    if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
    if (error) {
      showMessage(error.message || 'Save failed.', true);
      return;
    }
    showMessage('Details saved.');
  });

  endPartnershipForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!bowler) return;
    if (bowler.end_partnership_requested_at) return;
    var btn = endPartnershipForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    var reason = endPartnershipForm.querySelector('[name="reason"]').value || null;
    var now = new Date().toISOString();
    var { error } = await supabase
      .from('bowlers')
      .update({
        end_partnership_requested_at: now,
        end_partnership_reason: reason,
        updated_at: now,
      })
      .eq('id', bowler.id);
    if (btn) { btn.disabled = false; btn.textContent = 'Request to end partnership'; }
    if (error) {
      showMessage(error.message || 'Request failed.', true);
      return;
    }
    bowler.end_partnership_requested_at = now;
    endPartnershipDone.hidden = false;
    endPartnershipForm.querySelector('textarea').disabled = true;
    btn.disabled = true;
  });

  init();
})();
