(function () {
  const eyeEl = document.getElementById('eye');
  const joinBtn = document.getElementById('joinBtn');
  const formWrap = document.getElementById('formWrap');
  const portalForm = document.getElementById('portalForm');
  const confirmMsg = document.getElementById('confirmMsg');
  const glitchOverlay = document.getElementById('glitchOverlay');
  const blackout = document.getElementById('blackout');
  const screen = document.querySelector('.screen');

  let blinkCount = 0;

  // Supabase: optional, from config
  const config = window.PORTAL_CONFIG || {};
  const supabaseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const supabaseAnonKey = config.supabaseAnonKey || '';
  const supabase = supabaseUrl && supabaseAnonKey
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
    : null;

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

  function blink() {
    eyeEl.classList.add('blink');
    setTimeout(function () {
      eyeEl.classList.remove('blink');
      blinkCount++;
      if (blinkCount === 2) {
        joinBtn.hidden = false;
        joinBtn.classList.add('visible');
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
    joinBtn.hidden = true;
  }

  function firstFromFullName(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    const t = fullName.trim().split(/\s+/);
    return t[0] || '';
  }

  function showFormError(msg) {
    var el = document.getElementById('formError');
    if (!el) {
      el = document.createElement('p');
      el.id = 'formError';
      el.className = 'form-error-msg';
      portalForm.insertBefore(el, portalForm.firstChild);
    }
    el.textContent = msg;
    el.hidden = false;
  }

  function hideFormError() {
    var el = document.getElementById('formError');
    if (el) el.hidden = true;
  }

  async function sendPortalSms(firstName, mobile) {
    if (!supabaseUrl) return;
    const url = supabaseUrl + '/functions/v1/send-portal-sms';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + supabaseAnonKey,
      },
      body: JSON.stringify({ first_name: firstName, mobile: mobile }),
    });
    if (!res.ok) {
      console.warn('SMS send failed', await res.text());
    }
  }

  function showConfirmAndGlitch() {
    formWrap.hidden = true;
    confirmMsg.hidden = false;
    screen.classList.remove('form-active');
    screen.classList.add('confirm-active');
    setTimeout(triggerGlitchThenBlack, 2200);
  }

  function triggerGlitchThenBlack() {
    glitchOverlay.hidden = false;
    glitchOverlay.classList.add('active');
    setTimeout(function () {
      glitchOverlay.classList.remove('active');
      blackout.hidden = false;
      blackout.classList.add('visible');
    }, 700);
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
    var mobile = (portalForm.querySelector('[name="mobile"]') || {}).value || '';
    var referrer = (portalForm.querySelector('[name="referrer"]') || {}).value || null;
    var country = (portalForm.querySelector('[name="country"]') || {}).value || '';
    var firstName = firstFromFullName(fullName);
    var lastName = fullName.trim().split(/\s+/).slice(1).join(' ') || null;

    if (supabase) {
      try {
        var { data, error } = await supabase.from('bowlers').insert({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email: email,
          mobile: mobile,
          referrer: referrer || null,
          country: country,
          status: 'lead',
        }).select('id').single();

        if (error) {
          if (error.code === '23505') {
            showFormError('This email or phone is already registered.');
          } else {
            showFormError(error.message || 'Submission failed. Try again.');
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
          }
          return;
        }
        await sendPortalSms(firstName, mobile);
      } catch (err) {
        showFormError('Network error. Try again.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit';
        }
        return;
      }
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
    showConfirmAndGlitch();
  }

  joinBtn.addEventListener('click', onJoinClick);
  portalForm.addEventListener('submit', onFormSubmit);

  // Start eye sequence immediately (no typing)
  setTimeout(startEyeSequence, 400);
})();
