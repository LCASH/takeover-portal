(function () {
  // Flow: Join → form → submit → RPC insert_portal_lead → send-portal-sms (welcome SMS using org Twilio) → confirm → glitch → blackout.
  // Once login is enabled for them, they sign in at login.html and complete onboarding at portal.html.
  const eyeEl = document.getElementById('eye');
  const joinBtn = document.getElementById('joinBtn');
  const formWrap = document.getElementById('formWrap');
  const portalForm = document.getElementById('portalForm');
  const confirmMsg = document.getElementById('confirmMsg');
  const screen = document.querySelector('.screen');

  let blinkCount = 0;

  // Supabase: same project as main app; config.js has supabaseUrl + supabaseAnonKey.
  // Force anon role: no session storage so we never send a JWT (avoids RLS "authenticated" path).
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  const noStorage = {
    getItem: function () { return null; },
    setItem: function () {},
    removeItem: function () {},
  };
  const supabase = supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: noStorage,
        },
      })
    : null;

  // Show banner only on localhost when config is missing/placeholder (never in production)
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

  function showConfirm() {
    formWrap.hidden = true;
    confirmMsg.hidden = false;
    screen.classList.remove('form-active');
    screen.classList.add('confirm-active');
    // After 3 seconds, let them know to check their phone
    setTimeout(function() {
      confirmMsg.innerHTML = '<p>Check your phone for a message from us.</p>';
    }, 3000);
  }

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
    // Normalise to E.164: +<countryCode><digits>. Strip leading 0 from national number (e.g. 0403432913 -> 403432913 for AU).
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

    if (!supabase) {
      showFormError('Portal is not connected to the database. Please contact support.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
      return;
    }

    var orgId = (typeof window !== 'undefined' && window.PORTAL_CONFIG && window.PORTAL_CONFIG.organizationId) || null;
    try {
      var rpcPayload = {
        p_full_name: fullName,
        p_first_name: firstName,
        p_last_name: lastName,
        p_email: email,
        p_mobile: mobile,
        p_referrer: referrer || null,
        p_country: country,
        p_organization_id: orgId || null,
      };
      var rpcUrl = supabaseUrl + '/rest/v1/rpc/insert_portal_lead';
      var rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + supabaseAnonKey,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify(rpcPayload),
      });
      var responseText = await rpcRes.text();
      var bowlerId = null;
      try {
        bowlerId = responseText ? JSON.parse(responseText) : null;
      } catch (_) {}
      if (!rpcRes.ok) {
        var errMsg = 'Submission failed. Try again.';
        if (responseText) {
          try {
            var errBody = JSON.parse(responseText);
            if (errBody.code === '23505' || (errBody.message && errBody.message.indexOf('unique') !== -1)) {
              errMsg = 'This email or phone is already registered.';
            } else if (errBody.message) {
              errMsg = errBody.message;
            }
          } catch (_) {}
        }
        showFormError(errMsg);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
        }
        return;
      }
      var smsUrl = supabaseUrl + '/functions/v1/send-portal-sms';
      fetch(smsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + supabaseAnonKey,
        },
        body: JSON.stringify({
          bowler_id: bowlerId,
          first_name: firstName,
          mobile: mobile,
          organization_id: orgId || null,
        }),
      }).catch(function () {});
    } catch (err) {
      console.error('Portal submit error:', err);
      var msg = err && err.message ? err.message : 'Network error. Try again.';
      if (msg === 'Failed to fetch' || msg.indexOf('fetch') !== -1) {
        msg = 'Could not reach the server. Check your connection; if you\'re on localhost, open DevTools (F12) → Network and try again to see the blocked request.';
      }
      showFormError(msg);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
    showConfirm();
  }

  joinBtn.addEventListener('click', onJoinClick);
  portalForm.addEventListener('submit', onFormSubmit);

  // Start eye sequence immediately (no typing)
  setTimeout(startEyeSequence, 400);
})();
