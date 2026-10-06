(() => {
  "use strict";
  const watches = new Map();
  let sequence = 0;
  // Native actions are not necessarily sent under /api (e.g. server actions).
  const urls = [
    "https://www.wiki-masters.com/*",
    "https://wiki-masters.com/*",
    "https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/user_card_tags*",
  ];
  function finish(watch, result) {
    clearTimeout(watch.deadline);
    clearTimeout(watch.quiet);
    watch.finished = result;
    watch.resolve(result);
  }
  function settle(watch) {
    clearTimeout(watch.quiet);
    if (watch.finished || !watch.waiting || !watch.seen || watch.pending.size)
      return;
    watch.quiet = setTimeout(
      () => finish(watch, { ok: true, requests: watch.seen }),
      50,
    );
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (
      !message?.type?.startsWith("wm-label-watch-") ||
      !sender.tab ||
      sender.frameId !== 0
    )
      return;
    try {
      if (
        !["wiki-masters.com", "www.wiki-masters.com"].includes(
          new URL(sender.url).hostname,
        )
      )
        return;
    } catch {
      return;
    }
    const tabId = sender.tab.id;
    if (message.type === "wm-label-watch-start") {
      if (watches.has(tabId) && !watches.get(tabId).finished)
        return Promise.resolve({ error: "Une application est déjà en cours." });
      const watch = {
        tabId,
        token: String(++sequence),
        seen: 0,
        pending: new Set(),
        waiting: false,
      };
      watch.result = new Promise((resolve) => {
        watch.resolve = resolve;
      });
      watch.deadline = setTimeout(
        () =>
          finish(watch, {
            ok: false,
            error: watch.seen
              ? "Le site n’a pas terminé l’application."
              : "Impossible de confirmer l’application. L’étiquette a peut-être été ajoutée : vérifiez vos cartes avant de réessayer.",
          }),
        20000,
      );
      watches.set(tabId, watch);
      return Promise.resolve({ token: watch.token });
    }
    const watch = watches.get(tabId);
    if (!watch || watch.token !== message.token)
      return Promise.resolve({
        ok: false,
        error: "Suivi d’application expiré.",
      });
    // A closed native popup and the labels rendered on every selected card
    // also confirm success when Firefox does not attribute the request to this tab.
    // Never override an observed refusal or an in-flight request.
    if (message.type === "wm-label-watch-visible") {
      if (!watch.finished && !watch.seen)
        finish(watch, { ok: true, visible: true });
      return Promise.resolve({ ok: Boolean(watch.finished?.ok) });
    }
    if (message.type === "wm-label-watch-wait") {
      watch.waiting = true;
      settle(watch);
      return watch.result;
    }
    if (message.type === "wm-label-watch-cancel") {
      finish(watch, { ok: false, error: "Application interrompue." });
      watches.delete(tabId);
      return Promise.resolve({ ok: true });
    }
  });
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const watch = watches.get(details.tabId);
      if (
        !watch ||
        watch.finished ||
        !["POST", "PUT", "PATCH", "DELETE"].includes(details.method)
      )
        return;
      watch.seen++;
      watch.pending.add(details.requestId);
      clearTimeout(watch.quiet);
    },
    { urls },
  );
  browser.webRequest.onCompleted.addListener(
    (details) => {
      const watch = watches.get(details.tabId);
      if (!watch || watch.finished || !watch.pending.has(details.requestId))
        return;
      watch.pending.delete(details.requestId);
      if (details.statusCode < 200 || details.statusCode >= 300)
        finish(watch, {
          ok: false,
          error: `Le site a refusé l’application (${details.statusCode}).`,
        });
      else settle(watch);
    },
    { urls },
  );
  browser.webRequest.onErrorOccurred.addListener(
    (details) => {
      const watch = watches.get(details.tabId);
      if (watch && !watch.finished && watch.pending.has(details.requestId))
        finish(watch, {
          ok: false,
          error: "La requête d’application a échoué ou a été bloquée.",
        });
    },
    { urls },
  );
  browser.tabs.onRemoved.addListener((tabId) => {
    const watch = watches.get(tabId);
    if (watch) {
      finish(watch, { ok: false, error: "Onglet fermé." });
      watches.delete(tabId);
    }
  });
})();
