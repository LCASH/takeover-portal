(function () {
  // Flow: Join → Step 1 (expression of interest) → signup-and-auth edge function →
  // Step 2 (onboarding form with uploads) → submit → "reviewing your account" message.
  // Admin later calls enable-portal-login which sends credentials SMS.
  const eyeEl = document.getElementById('eye');
  const joinBtn = document.getElementById('joinBtn');
  const formWrap = document.getElementById('formWrap');
  const portalForm = document.getElementById('portalForm');
  const confirmMsg = document.getElementById('confirmMsg');
  const onboardingWrap = document.getElementById('onboardingWrap');
  const onboardingForm = document.getElementById('onboardingForm');
  const screen = document.querySelector('.screen');

  let blinkCount = 0;

  // Supabase config
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  const BUCKET = 'portal-documents';

  // Anon client for Step 1 (no session storage)
  const noStorage = {
    getItem: function () { return null; },
    setItem: function () { },
    removeItem: function () { },
  };
  const anonClient = supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: noStorage,
      },
    })
    : null;

  // Authenticated client created after Step 1 signup
  var authClient = null;
  var currentBowlerId = null;

  // Show banner only on localhost when config is missing/placeholder
  var configBanner = document.getElementById('configBanner');
  var isLocalhost = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  var looksPlaceholder = !supabaseUrl || !supabaseAnonKey ||
    /your-project|x\.supabase\.co/.test(supabaseUrl) ||
    /your-anon-key|^anon$/.test((supabaseAnonKey || '').trim());
  if (configBanner && isLocalhost && looksPlaceholder) {
    configBanner.hidden = false;
  }

  // Populate searchable country datalist
  if (window.PORTAL_COUNTRIES) {
    const list = document.getElementById('country-list');
    if (list) {
      window.PORTAL_COUNTRIES.forEach(function (c) {
        const opt = document.createElement('option');
        opt.value = c;
        list.appendChild(opt);
      });
    }
  }

  // Populate mobile country code dropdown (E.164)
  if (window.PORTAL_PHONE_COUNTRY_CODES) {
    var sel = portalForm.querySelector('[name="mobile_country"]');
    if (sel) {
      window.PORTAL_PHONE_COUNTRY_CODES.forEach(function (x) {
        var opt = document.createElement('option');
        opt.value = x.code;
        opt.textContent = x.label;
        sel.appendChild(opt);
      });
    }
  }

  const introText = document.getElementById('introText');
  const centerWrapper = document.querySelector('.center-wrapper');

  // --- Eye animation ---
  function blink() {
    eyeEl.classList.add('blink');
    setTimeout(function () {
      eyeEl.classList.remove('blink');
      blinkCount++;
      if (blinkCount === 2) {
        if (introText) {
          introText.hidden = false;
          introText.classList.add('visible');
        }
        if (centerWrapper) centerWrapper.classList.add('intro-visible');
        setTimeout(function () {
          joinBtn.hidden = false;
          joinBtn.classList.add('visible');
        }, 400);
      }
    }, 140);
  }

  function startEyeSequence() {
    setTimeout(blink, 600);
    setTimeout(blink, 2200);
  }

  function onJoinClick() {
    formWrap.hidden = false;
    screen.classList.add('form-active');
    if (introText) {
      introText.classList.remove('visible');
      setTimeout(() => introText.hidden = true, 500);
    }
    joinBtn.classList.remove('visible');
    setTimeout(() => joinBtn.hidden = true, 500);
  }

  // --- Helpers ---
  function firstFromFullName(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    const t = fullName.trim().split(/\s+/);
    return t[0] || '';
  }

  function showFormError(msg) {
    var el = document.getElementById('formError');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  function hideFormError() {
    var el = document.getElementById('formError');
    if (el) el.hidden = true;
  }

  function showOnboardingError(msg) {
    var el = document.getElementById('onboardingError');
    if (el) {
      el.textContent = msg;
      el.hidden = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function hideOnboardingError() {
    var el = document.getElementById('onboardingError');
    if (el) el.hidden = true;
  }

  // --- Upload zone setup (ported from portal.js) ---
  function setUploadZoneText(zone, text) {
    var textEl = zone.querySelector('.upload-text');
    if (textEl) textEl.textContent = text;
    else zone.textContent = text;
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

  // --- Bank selection setup (ported from portal.js) ---
  function setupBanks() {
    var list = document.getElementById('banksList');
    if (!list || !window.PORTAL_BANKS) return;
    list.innerHTML = '';
    window.PORTAL_BANKS.forEach(function (bank) {
      var label = document.createElement('label');
      label.className = 'bank-card flex items-center p-3 rounded-lg gap-3';
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

  // --- Retry wrapper (ported from portal.js) ---
  function withRetry(fn, label) {
    var attempts = 3;
    return function () {
      var lastErr;
      return (function run() {
        return fn().catch(function (err) {
          lastErr = err;
          attempts--;
          if (attempts > 0) {
            return new Promise(function (r) { setTimeout(r, 1500); }).then(run);
          }
          throw lastErr;
        });
      })();
    };
  }

  // --- UI transitions ---
  function showOnboarding() {
    formWrap.hidden = true;
    screen.classList.remove('form-active');
    screen.classList.add('onboarding-active');
    onboardingWrap.hidden = false;

    // Pre-fill referrer from Step 1
    var ref = (portalForm.querySelector('[name="referrer"]') || {}).value;
    if (ref) {
      var refInput = onboardingForm.querySelector('[name="referrer"]');
      if (refInput) refInput.value = ref;
    }

    // Setup upload zones and banks
    setupBanks();
    setupUpload('selfieZone', 'selfieInput');
    setupUpload('licenseFrontZone', 'licenseFrontInput');
    setupUpload('licenseBackZone', 'licenseBackInput');
    setupUpload('consentVideoZone', 'consentVideoInput');

    // Scroll to top
    window.scrollTo(0, 0);
  }

  function showPostSubmission() {
    onboardingWrap.hidden = true;
    screen.classList.remove('onboarding-active');
    confirmMsg.hidden = false;
    screen.classList.add('confirm-active');
    // Wire up Telegram card from config
    var tgUrl = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.telegramInviteUrl) || '';
    var tgCard = document.getElementById('confirmTelegramCard');
    if (tgCard) tgCard.style.display = tgUrl ? '' : 'none';
    var tgLink = document.getElementById('confirmTelegramLink');
    if (tgLink && tgUrl) tgLink.href = tgUrl;
    window.scrollTo(0, 0);
  }

  // --- Step 1: Expression of interest ---
  async function onFormSubmit(e) {
    e.preventDefault();
    hideFormError();
    var submitBtn = portalForm.querySelector('.submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
    }

    var fullName = (portalForm.querySelector('[name="fullname"]') || {}).value || '';
    var email = (portalForm.querySelector('[name="email"]') || {}).value || '';
    var countryCode = (portalForm.querySelector('[name="mobile_country"]') || {}).value || '';
    var mobileNumber = (portalForm.querySelector('[name="mobile_number"]') || {}).value || '';
    var digits = (mobileNumber || '').replace(/\D/g, '');
    if (digits.charAt(0) === '0') digits = digits.replace(/^0+/, '');
    var mobile = (countryCode && digits) ? '+' + countryCode.replace(/\D/g, '') + digits : '';
    if (!mobile) {
      showFormError('Please choose a country code and enter your mobile number.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
      return;
    }
    var referrer = (portalForm.querySelector('[name="referrer"]') || {}).value || null;
    var country = (portalForm.querySelector('[name="country"]') || {}).value || '';
    var firstName = firstFromFullName(fullName);
    var lastName = fullName.trim().split(/\s+/).slice(1).join(' ') || null;

    if (!anonClient) {
      showFormError('Portal is not connected to the database. Please contact support.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
      return;
    }

    var orgId = (typeof window !== 'undefined' && window.PORTAL_CONFIG && window.PORTAL_CONFIG.organizationId) || null;
    try {
      var response = await fetch(supabaseUrl + '/functions/v1/signup-and-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + supabaseAnonKey,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email: email,
          mobile: mobile,
          referrer: referrer || null,
          country: country,
          organization_id: orgId || null,
        }),
      });

      var responseText = await response.text();
      var result;
      try { result = JSON.parse(responseText); } catch (_) { result = {}; }

      if (!response.ok) {
        var errMsg = result.error || 'Submission failed. Try again.';
        showFormError(errMsg);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
        return;
      }

      currentBowlerId = result.bowler_id;

      // Create authenticated client with session (persisted in localStorage for browser close survival)
      authClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: window.localStorage,
        },
      });
      await authClient.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }

      // Send welcome SMS with community link
      var tgUrl = (window.PORTAL_CONFIG && window.PORTAL_CONFIG.telegramInviteUrl) || '';
      fetch(supabaseUrl + '/functions/v1/send-portal-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          bowler_id: currentBowlerId,
          first_name: firstName,
          mobile: mobile,
          telegram_url: tgUrl || undefined,
        }),
      }).catch(function (err) {
        console.error('SMS send error (non-blocking):', err);
      });

      showOnboarding();
    } catch (err) {
      console.error('Portal submit error:', err);
      var msg = err && err.message ? err.message : 'Network error. Try again.';
      if (msg === 'Failed to fetch' || msg.indexOf('fetch') !== -1) {
        msg = 'Could not reach the server. Check your connection and try again.';
      }
      showFormError(msg);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
    }
  }

  // --- Step 2: Onboarding form submission ---
  async function onOnboardingSubmit(e) {
    e.preventDefault();
    hideOnboardingError();
    if (!authClient || !currentBowlerId) {
      showOnboardingError('Session lost. Please refresh the page and start again.');
      return;
    }

    var selfieFile = document.getElementById('selfieInput').files[0];
    var licenseFrontFile = document.getElementById('licenseFrontInput').files[0];
    var licenseBackFile = document.getElementById('licenseBackInput').files[0];
    var consentVideoFile = document.getElementById('consentVideoInput').files[0];

    if (!selfieFile || !licenseFrontFile || !licenseBackFile) {
      showOnboardingError('Please upload Selfie ID, Front of ID, and Back of ID.');
      return;
    }
    if (!consentVideoFile) {
      showOnboardingError('Please upload your consent video.');
      return;
    }

    var btn = onboardingForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    // Validate file sizes
    var MAX_IMAGE_MB = 6;
    var MAX_VIDEO_MB = 50;
    var maxImageBytes = MAX_IMAGE_MB * 1024 * 1024;
    var maxVideoBytes = MAX_VIDEO_MB * 1024 * 1024;
    if (selfieFile.size > maxImageBytes || licenseFrontFile.size > maxImageBytes || licenseBackFile.size > maxImageBytes) {
      showOnboardingError('One or more ID files are too large (max ' + MAX_IMAGE_MB + 'MB each). Use smaller photos or compress them.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
      return;
    }
    if (consentVideoFile.size > maxVideoBytes) {
      showOnboardingError('Video file is too large (max ' + MAX_VIDEO_MB + 'MB). Use a shorter video or compress it.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
      return;
    }

    // Read form values
    var dateOfBirth = onboardingForm.querySelector('[name="date_of_birth"]').value || null;
    var address = onboardingForm.querySelector('[name="address"]').value || null;
    var referrer = onboardingForm.querySelector('[name="referrer"]').value || null;
    var previousBettingAccounts = onboardingForm.querySelector('[name="previous_betting_accounts"]').value || null;
    var bankAccountName = onboardingForm.querySelector('[name="bank_account_name"]').value || null;
    var bankBsb = onboardingForm.querySelector('[name="bank_bsb"]').value || null;
    var bankAccountNumber = onboardingForm.querySelector('[name="bank_account_number"]').value || null;
    var bankPayId = onboardingForm.querySelector('[name="bank_pay_id"]').value || null;
    var banksChecked = [];
    onboardingForm.querySelectorAll('input[name="banks_consent"]:checked').forEach(function (cb) {
      banksChecked.push(cb.value);
    });

    var ext = function (f) { return f.name.split('.').pop()?.toLowerCase() || 'bin'; };
    var prefix = currentBowlerId + '/';

    try {
      var upload = async function (file, pathSuffix) {
        var path = prefix + pathSuffix + '.' + ext(file);
        var doUpload = function () {
          return authClient.storage.from(BUCKET).upload(path, file, { upsert: true }).then(function (_ref) {
            var error = _ref.error;
            if (error) throw error;
            return path;
          });
        };
        return withRetry(doUpload, pathSuffix)();
      };

      var selfiePath = await upload(selfieFile, 'selfie');
      var licenseFrontPath = await upload(licenseFrontFile, 'license_front');
      var licenseBackPath = await upload(licenseBackFile, 'license_back');
      var consentVideoPath = await upload(consentVideoFile, 'consent_video');

      var now = new Date().toISOString();
      var updatePayload = {
        date_of_birth: dateOfBirth,
        address: address,
        referrer: referrer,
        previous_betting_accounts: previousBettingAccounts,
        banks_consent: banksChecked,
        bank_account_name: bankAccountName,
        bank_bsb: bankBsb,
        bank_account_number: bankAccountNumber,
        bank_pay_id: bankPayId,
        selfie_url: selfiePath,
        license_front_url: licenseFrontPath,
        license_back_url: licenseBackPath,
        consent_video_url: consentVideoPath,
        accept_betting_tcs_at: now,
        accept_bank_paypal_tcs_at: now,
        confirm_details_entered_at: now,
        required_form_completed_at: now,
        status: 'onboarding_submitted',
        onboarding_stage: 'form_submitted',
        updated_at: now,
      };

      var doUpdate = function () {
        return authClient.from('bowlers').update(updatePayload).eq('id', currentBowlerId).then(function (_ref2) {
          var error = _ref2.error;
          if (error) throw error;
        });
      };
      await withRetry(doUpdate, 'update')();

      showPostSubmission();
    } catch (err) {
      var friendly = 'Connection or server issue — nothing was saved yet. Your form is still here. Try again (e.g. on Wi‑Fi or with smaller photos).';
      if (err && err.message && /size|large|quota/i.test(err.message)) {
        friendly = 'File too large or quota exceeded. Use smaller files and try again.';
      }
      showOnboardingError(friendly);
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
    }
  }

  // --- Session resume: check for existing auth session on page load ---
  async function tryResumeSession() {
    if (!supabaseUrl || !supabaseAnonKey) return false;
    try {
      var resumeClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage },
      });
      var sessionResult = await resumeClient.auth.getSession();
      var session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (!session || !session.user) return false;

      // Session exists — check if form is already completed
      var bowlerResult = await resumeClient.from('bowlers')
        .select('id, required_form_completed_at')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      var bowler = bowlerResult && bowlerResult.data;
      if (!bowler) return false;

      if (bowler.required_form_completed_at) {
        // Form already completed — show confirmation screen
        authClient = resumeClient;
        currentBowlerId = bowler.id;
        showPostSubmission();
        return true;
      }

      // Form not completed — resume at Step 2
      authClient = resumeClient;
      currentBowlerId = bowler.id;
      showOnboarding();
      return true;
    } catch (err) {
      console.warn('Session resume failed:', err);
      // Clear stale session data
      try { window.localStorage.removeItem('sb-' + supabaseUrl.split('//')[1]?.split('.')[0] + '-auth-token'); } catch (_) {}
      return false;
    }
  }

  // --- Event listeners ---
  joinBtn.addEventListener('click', onJoinClick);
  portalForm.addEventListener('submit', onFormSubmit);
  onboardingForm.addEventListener('submit', onOnboardingSubmit);

  // Check for existing session first, otherwise start normal flow
  tryResumeSession().then(function (resumed) {
    if (!resumed) {
      setTimeout(startEyeSequence, 400);
    }
  });
})();
