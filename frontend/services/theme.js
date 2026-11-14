// Applies the saved theme before first paint and exposes a toggle. Loaded as a classic blocking script in <head>.
(function () {
  var KEY = 'kit_theme';
  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function apply(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  apply(saved());
  window.kitTheme = {
    current: function () {
      return document.documentElement.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light');
    },
    toggle: function () {
      var next = this.current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* storage unavailable: the choice lasts for this page only */
      }
      return next;
    },
  };
})();
