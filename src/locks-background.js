(() => {
  "use strict";
  const collections = new Map();
  let locks = {},
    loaded = false;
  const ready = browser.storage.local.get("cardLocks").then((data) => {
    locks = data.cardLocks ?? {};
    loaded = true;
  });
  // Attach a rejection handler immediately; request handlers still receive the failure.
  void ready.catch(() => {
    /* Handled explicitly by readiness and request handlers. */
  });
  let updates = ready;
  const trusted = (sender) => {
    try {
      return (
        sender.tab &&
        sender.frameId === 0 &&
        ["wiki-masters.com", "www.wiki-masters.com"].includes(
          new URL(sender.url).hostname,
        )
      );
    } catch {
      return false;
    }
  };
  async function broadcast() {
    const tabs = await browser.tabs.query({
      url: ["https://wiki-masters.com/*", "https://www.wiki-masters.com/*"],
    });
    await Promise.all(
      tabs.map((tab) =>
        browser.tabs
          .sendMessage(tab.id, { type: "wm-locks", locks }, { frameId: 0 })
          .catch(() => {
            /* Closed or navigating tabs cannot receive status updates. */
          }),
      ),
    );
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!trusted(sender)) return;
    if (message?.type === "wm-locks-ready")
      return ready.then(() => ({ type: "wm-locks", locks }));
    if (
      message?.type !== "wm-set-locks" ||
      !Array.isArray(message.keys) ||
      typeof message.locked !== "boolean"
    )
      return;
    const operation = updates.then(async () => {
      const next = { ...locks },
        cards = collections.get(sender.tab.id) ?? [];
      for (const key of new Set(message.keys)) {
        const matching = cards.filter((card) => WMLockPolicy.key(card) === key);
        if (message.locked && matching.length) {
          next[key] = {
            id: matching[0].id,
            rarity: matching[0].rarity,
            ownedIds: [
              ...new Set(matching.map((card) => card.ownedId).filter(Boolean)),
            ],
          };
        } else if (!message.locked) delete next[key];
      }
      await browser.storage.local.set({ cardLocks: next });
      locks = next;
      await broadcast();
      return { type: "wm-locks", locks };
    });
    updates = operation.catch(() => {
      /* Keep later writes possible; the caller receives this operation’s error. */
    });
    return operation;
  });
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!WMLockPolicy.isRemoval(details)) return { cancel: false };
      const unavailable = () => {
        if (details.tabId >= 0)
          browser.tabs
            .sendMessage(
              details.tabId,
              { type: "wm-locks-unavailable" },
              { frameId: 0 },
            )
            .catch(() => {
              /* Closed or navigating tabs cannot receive status updates. */
            });
        return { cancel: true };
      };
      const check = () => {
        if (globalThis.WMFeatures && !WMFeatures.enabled("locks"))
          return { cancel: false };
        const cancel = WMLockPolicy.blocked(
          details,
          locks,
          collections.get(details.tabId) ?? [],
        );
        if (cancel && details.tabId >= 0)
          browser.tabs
            .sendMessage(
              details.tabId,
              { type: "wm-lock-blocked" },
              { frameId: 0 },
            )
            .catch(() => {
              /* Closed or navigating tabs cannot receive status updates. */
            });
        return { cancel };
      };
      if (globalThis.WMFeatures)
        return WMFeatures.whenReady.then(() => {
          if (!WMFeatures.enabled("locks")) return { cancel: false };
          return ready.then(check, unavailable);
        }, unavailable);
      return loaded ? check() : ready.then(check, unavailable);
    },
    {
      urls: [
        "https://wiki-masters.com/api/*",
        "https://www.wiki-masters.com/api/*",
      ],
    },
    ["blocking", "requestBody"],
  );
  globalThis.WMLockGuard = Object.freeze({
    remember(tabId, cards) {
      collections.set(tabId, cards);
    },
    forget(tabId) {
      collections.delete(tabId);
    },
  });
})();
