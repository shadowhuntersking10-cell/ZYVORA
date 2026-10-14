/* Landing page interactions: theme toggle (persisted). */
(function () {
  var btn = document.getElementById('themeBtn');
  if (!btn) return;
  function paint() {
    var t = document.documentElement.getAttribute('data-theme') || 'dark';
    btn.textContent = t === 'dark' ? '🌙' : '☀️';
    btn.title = t === 'dark' ? '🌙' : '☀️';
  }
  btn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('zyvora_theme', cur); } catch (e) {}
    paint();
  });
  paint();
})();
