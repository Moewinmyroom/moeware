'use strict';

// Apply before the stylesheet paints; appearance is independent of AI requests.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const saved = localStorage.getItem('coach-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* The toggle still works when browser storage is unavailable. */ }

  function applyTheme() {
    const dark = (preference || (system.matches ? 'dark' : 'light')) === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1d231f' : '#f3f1e9');
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.textContent = dark ? '☀ Light' : '☾ Dark';
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  applyTheme();
  system.addEventListener('change', () => { if (!preference) applyTheme(); });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('themeToggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('coach-theme', preference); } catch { /* Session-only preference. */ }
      applyTheme();
    });
  });
})();
