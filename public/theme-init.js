// Apply the saved or system theme before first paint to avoid a flash.
// A file rather than an inline script, so the Content-Security-Policy can refuse inline scripts.
(function () {
  try {
    var saved = localStorage.getItem('acme-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
