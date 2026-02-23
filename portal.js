(function () {
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    document.getElementById('loadingEl').innerHTML = 'Portal is not configured.';
    return;
  }
  const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  const BUCKET = 'portal-documents';

  const loadingEl = document.getElementById('loadingEl');
  const accessDeniedEl = document.getElementById('accessDeniedEl');
  const onboardingEl = document.getElementById('onboardingEl');
  const thanksEl = document.getElementById('thanksEl');
  const onboardingForm = document.getElementById('onboardingForm');
  const formError = document.getElementById('formError');
  const statusLabel = document.getElementById('statusLabel');
  const statusSubtext = document.getElementById('statusSubtext');
  const confirmedLine = document.getElementById('confirmedLine');
  const signOutLink = document.getElementById('signOutLink');
  const discordLink = document.getElementById('discordLink');
  const discordCard = document.getElementById('discordCard');

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
    var discordUrl = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.discordInviteUrl) || '';
    if (discordLink) discordLink.href = discordUrl || '#';
    if (discordCard) discordCard.style.display = discordUrl ? '' : 'none';
    thanksEl.hidden = false;
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }
  function hideError() {
    formError.hidden = true;
  }

  function setUploadZoneText(zone, text) {
    var textEl = zone.querySelector('.upload-text');
    if (textEl) textEl.textContent = text;
    else zone.textContent = text;
  }

  function setupBanks() {
    const list = document.getElementById('banksList');
    if (!list || !window.PORTAL_BANKS) return;
    list.innerHTML = '';
    window.PORTAL_BANKS.forEach(function (bank) {
      var label = document.createElement('label');
      label.className = 'bank-card flex items-center p-3 rounded-lg gap-3 hover:bg-[#23272c]';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'banks_consent';
      input.value = bank;
      input.addEventListener('change', function () { label.classList.toggle('selected', input.checked); });
      label.appendChild(input);
      label.appendChild(document.createTextNode(bank));
      list.appendChild(label);
    });
  }

  function setupUpload(idZone, idInput) {
    var zone = document.getElementById(idZone);
    var input = document.getElementById(idInput);
    if (!zone || !input) return;
    var defaultText = zone.getAttribute('data-placeholder') || 'Drop files here or browse';
    function highlight() { zone.classList.add('dragover'); }
    function unhighlight() { zone.classList.remove('dragover'); }
    function updateLabel() {
      var name = input.files[0] && input.files[0].name;
      setUploadZoneText(zone, name ? '\u2713 ' + name : defaultText);
      zone.classList.toggle('has-file', !!name);
    }
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); highlight(); });
    zone.addEventListener('dragleave', unhighlight);
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      unhighlight();
      if (e.dataTransfer.files.length) input.files = e.dataTransfer.files;
      updateLabel();
    });
    input.addEventListener('change', updateLabel);
  }

  function onboardingComplete(b) {
    return !!(b && b.date_of_birth && b.selfie_url && b.license_front_url && b.license_back_url);
  }

  async function init() {
    setupBanks();
    setupUpload('selfieZone', 'selfieInput');
    setupUpload('licenseFrontZone', 'licenseFrontInput');
    setupUpload('licenseBackZone', 'licenseBackInput');

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
    if (onboardingComplete(bowler)) {
      // Refetch so status is up to date when they return to the portal
      var { data: fresh } = await supabase.from('bowlers').select('*').eq('id', bowler.id).single();
      if (fresh) bowler = fresh;
      showDashboard(bowler);
    } else {
      onboardingEl.hidden = false;
      if (bowler.date_of_birth) onboardingForm.querySelector('[name="date_of_birth"]').value = bowler.date_of_birth;
      if (bowler.address) onboardingForm.querySelector('[name="address"]').value = bowler.address;
      if (bowler.referrer) onboardingForm.querySelector('[name="referrer"]').value = bowler.referrer;
      if (bowler.previous_betting_accounts) onboardingForm.querySelector('[name="previous_betting_accounts"]').value = bowler.previous_betting_accounts;
      if (bowler.banks_consent && bowler.banks_consent.length) {
        bowler.banks_consent.forEach(function (bank) {
          var cb = onboardingForm.querySelector('input[name="banks_consent"][value="' + bank + '"]');
          if (cb) {
            cb.checked = true;
            var label = cb.closest('label');
            if (label) label.classList.add('selected');
          }
        });
      }
    }

    signOutLink.addEventListener('click', async function (e) {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    });
  }

  // Form submit: writes directly to the same bowler row we loaded by auth_user_id (see init).
  // All fields map to public.bowlers columns; RLS allows update only where auth_user_id = auth.uid().
  onboardingForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError();
    if (!bowler) return;
    var selfieFile = document.getElementById('selfieInput').files[0];
    var licenseFrontFile = document.getElementById('licenseFrontInput').files[0];
    var licenseBackFile = document.getElementById('licenseBackInput').files[0];
    if (!selfieFile || !licenseFrontFile || !licenseBackFile) {
      showError('Please upload Selfie ID, Front of License, and Back of License.');
      return;
    }
    var btn = onboardingForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    var dateOfBirth = onboardingForm.querySelector('[name="date_of_birth"]').value || null;
    var address = onboardingForm.querySelector('[name="address"]').value || null;
    var referrer = onboardingForm.querySelector('[name="referrer"]').value || null;
    var previousBettingAccounts = onboardingForm.querySelector('[name="previous_betting_accounts"]').value || null;
    var banksChecked = [];
    onboardingForm.querySelectorAll('input[name="banks_consent"]:checked').forEach(function (cb) {
      banksChecked.push(cb.value);
    });

    var ext = function (f) { return f.name.split('.').pop()?.toLowerCase() || 'jpg'; };
    var prefix = bowler.id + '/';

    try {
      // Upload to Supabase Storage; store object path in DB. Full image URL = {supabaseUrl}/storage/v1/object/public/portal-documents/{path}
      var upload = async function (file, pathSuffix) {
        var path = prefix + pathSuffix + '.' + ext(file);
        var { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        return path;
      };
      var selfiePath = await upload(selfieFile, 'selfie');
      var licenseFrontPath = await upload(licenseFrontFile, 'license_front');
      var licenseBackPath = await upload(licenseBackFile, 'license_back');

      var now = new Date().toISOString();
      // Update the bowler row by id (same row we loaded with auth_user_id = session.user.id)
      var { error: updateErr } = await supabase
        .from('bowlers')
        .update({
          date_of_birth: dateOfBirth,
          address: address,
          referrer: referrer,
          previous_betting_accounts: previousBettingAccounts,
          banks_consent: banksChecked,
          selfie_url: selfiePath,
          license_front_url: licenseFrontPath,
          license_back_url: licenseBackPath,
          accept_betting_tcs_at: now,
          accept_bank_paypal_tcs_at: now,
          confirm_details_entered_at: now,
          required_form_completed_at: now,
          status: 'onboarding_submitted',
          updated_at: now,
        })
        .eq('id', bowler.id);
      if (updateErr) throw updateErr;

      bowler.status = 'onboarding_submitted';
      bowler.required_form_completed_at = now;
      onboardingEl.hidden = true;
      showDashboard(bowler);
    } catch (err) {
      showError(err.message || 'Submission failed. Try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    }
  });

  init();
})();
