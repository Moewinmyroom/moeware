'use strict';

// Recovery and update controls must work even if app.js or storage cannot start.
(() => {
  const panel = document.getElementById('startupBanner');
  const message = document.getElementById('startupMessage');
  const updatePanel = document.getElementById('updateBanner');
  const reload = document.getElementById('startupReload');
  const update = document.getElementById('installUpdate');
  let registration = null, applyingUpdate = false;
  const watchdog = setTimeout(() => status('Still opening your saved data. Close other Wrinkle Coach tabs and app windows, then tap Reload app. Your conversations have not been deleted.'), 15000);

  function status(text) {
    clearTimeout(watchdog);
    message.textContent = text;
    panel.hidden = false;
  }
  window.WrinkleStartup = {
    status,
    ready() { clearTimeout(watchdog); panel.hidden = true; }
  };
  function showUpdate() { updatePanel.hidden = !registration?.waiting; }
  function installUpdate() {
    if (!registration?.waiting) { location.reload(); return; }
    applyingUpdate = true;
    update.disabled = true;
    update.textContent = 'Updating…';
    registration.waiting.postMessage({type:'SKIP_WAITING'});
  }
  update.addEventListener('click', installUpdate);
  reload.addEventListener('click', installUpdate);
  window.addEventListener('error', event => {
    if (event.target?.tagName === 'SCRIPT') status('An app file could not load. Reconnect and tap Reload app. Your saved data is still on this device.');
  }, true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applyingUpdate) location.reload();
    });
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(reg => {
      registration = reg;
      showUpdate();
      function watch(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
      }
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      reg.update().catch(() => {});
    }).catch(() => { /* Online app remains usable without offline installation. */ });
  }
})();
