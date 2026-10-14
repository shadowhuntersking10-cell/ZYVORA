/* Auth pages: real submission, validation, honest errors. */
(function () {
  var lang = window.ZY_LANG || 'uz';
  var T = {
    uz: {
      name_short: "Ism kamida 2 belgidan iborat bo'lsin.",
      email_invalid: "Email manzil noto'g'ri.",
      pass_short: "Parol kamida 8 belgidan iborat bo'lsin.",
      pass_mismatch: "Parollar mos kelmadi.",
      loading: "Yuborilmoqda...",
      generic: "Xatolik yuz berdi. Qaytadan urinib ko'ring."
    },
    en: {
      name_short: "Name must be at least 2 characters.",
      email_invalid: "Invalid email address.",
      pass_short: "Password must be at least 8 characters.",
      pass_mismatch: "Passwords do not match.",
      loading: "Submitting...",
      generic: "Something went wrong. Please try again."
    },
    ru: {
      name_short: "Имя должно содержать минимум 2 символа.",
      email_invalid: "Неверный email адрес.",
      pass_short: "Пароль должен содержать минимум 8 символов.",
      pass_mismatch: "Пароли не совпадают.",
      loading: "Отправка...",
      generic: "Произошла ошибка. Попробуйте ещё раз."
    }
  }[lang] || {};
  var emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

  function err(msg) { document.getElementById('formError').textContent = msg || ''; }
  function busy(on, btn) {
    if (on) { btn.dataset.txt = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + (T.loading || '...'); }
    else { btn.disabled = false; btn.textContent = btn.dataset.txt || btn.textContent; }
  }

  var langSeg = document.getElementById('langSeg');
  if (langSeg) {
    langSeg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      langSeg.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
    });
  }
  function chosenLang() {
    var a = langSeg && langSeg.querySelector('button.active');
    return a ? a.dataset.lang : lang;
  }

  var form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault(); err();
    var email = form.email.value.trim(), password = form.password.value;
    if (!emailRe.test(email)) return err(T.email_invalid);
    if (password.length < 1) return err(T.pass_short);
    var btn = document.getElementById('submitBtn'); busy(true, btn);
    try {
      var r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) });
      var data = await r.json();
      if (r.ok && data.ok) { window.location = '/dashboard'; return; }
      err(data.error || T.generic);
    } catch (ex) { err(T.generic); }
    busy(false, btn);
  });

  form = document.getElementById('regForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault(); err();
    var name = form.name.value.trim(), email = form.email.value.trim();
    var p1 = form.password.value, p2 = form.password2.value;
    if (name.length < 2) return err(T.name_short);
    if (!emailRe.test(email)) return err(T.email_invalid);
    if (p1.length < 8) return err(T.pass_short);
    if (p1 !== p2) return err(T.pass_mismatch);
    var btn = document.getElementById('submitBtn'); busy(true, btn);
    try {
      var r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, email: email, password: p1, password2: p2, lang: chosenLang() }) });
      var data = await r.json();
      if (r.ok && data.ok) {
        try { localStorage.setItem('zyvora_theme', document.documentElement.getAttribute('data-theme')); } catch (ex) {}
        window.location = '/dashboard'; return;
      }
      err(data.error || T.generic);
    } catch (ex) { err(T.generic); }
    busy(false, btn);
  });

  form = document.getElementById('forgotForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault(); err();
    if (!emailRe.test(form.email.value.trim())) return err(T.email_invalid);
    var btn = form.querySelector('button[type=submit]'); busy(true, btn);
    try {
      var r = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.value.trim() }) });
      var data = await r.json();
      var box = document.getElementById('devLink');
      if (data.dev_link) { box.style.display = 'block'; box.innerHTML = '<b>DEV:</b> SMTP sozlanmagan.<br><a href="' + data.dev_link + '">' + data.dev_link + '</a>'; }
      form.reset();
    } catch (ex) { err(T.generic); }
    busy(false, btn);
  });

  form = document.getElementById('resetForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault(); err();
    if (form.password.value.length < 8) return err(T.pass_short);
    if (form.password.value !== form.password2.value) return err(T.pass_mismatch);
    var btn = form.querySelector('button[type=submit]'); busy(true, btn);
    try {
      var r = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: window.ZY_RESET_TOKEN, password: form.password.value, password2: form.password2.value }) });
      var data = await r.json();
      if (r.ok && data.ok) { window.location = '/login'; return; }
      err(data.error || T.generic);
    } catch (ex) { err(T.generic); }
    busy(false, btn);
  });
})();
