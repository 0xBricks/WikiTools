(() => {
  "use strict";
  const listeners = new Set();
  let pending = false,
    lastRoute = location.href,
    lastRouter,
    lastPush,
    lastReplace;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          console.warn("Wiki tools: page update failed", error);
        }
      }
    }, 100);
  }
  new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          !record.target.closest?.(
            ".wm-toolbar, .wm-native-lock-actions, .wm-lock-marker, .wmfa-overlay, .wmfa-fa, .wmfa-frame",
          ),
      )
    )
      schedule();
  }).observe(document, { childList: true, subtree: true, characterData: true });
  for (const event of ["popstate", "hashchange", "pageshow"])
    window.addEventListener(event, schedule);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  // pushState does not emit popstate. Checking identities covers silent SPA changes
  // and delayed Next.js initialization without traversing the page every second.
  setInterval(() => {
    if (document.hidden) return;
    const router = window.wrappedJSObject?.next?.router;
    if (
      location.href !== lastRoute ||
      router !== lastRouter ||
      router?.push !== lastPush ||
      router?.replace !== lastReplace
    ) {
      lastRoute = location.href;
      lastRouter = router;
      lastPush = router?.push;
      lastReplace = router?.replace;
      schedule();
    }
  }, 1000);
  globalThis.WMPageEvents = Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
    },
    schedule,
  });
})();
