/* Observe only collection responses, forwarding every byte unchanged. */
(() => {
  "use strict";
  let sequence = 0;
  const pages = new Map();
  const generations = new Map();
  const hosts = new Set(["www.wiki-masters.com", "wiki-masters.com"]);
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const url = new URL(details.url);
      if (
        details.method !== "GET" ||
        details.tabId < 0 ||
        url.pathname !== "/api/my-collection"
      )
        return;
      const generation = ++sequence;
      generations.set(details.tabId, generation);
      let filter;
      try {
        filter = browser.webRequest.filterResponseData(details.requestId);
      } catch {
        return;
      }
      const decoder = new TextDecoder();
      let text = "",
        bytes = 0;
      filter.ondata = (event) => {
        filter.write(event.data);
        bytes += event.data.byteLength;
        if (bytes <= 8 * 1024 * 1024)
          text += decoder.decode(event.data, { stream: true });
      };
      filter.onstop = () => {
        filter.close();
        if (
          bytes > 8 * 1024 * 1024 ||
          generations.get(details.tabId) !== generation
        )
          return;
        let cards;
        try {
          cards = WMCollection.collection(JSON.parse(text + decoder.decode()));
        } catch {
          return;
        }
        const message = { type: "wm-collection", cards, generation };
        WMLockGuard.remember(details.tabId, cards);
        pages.set(details.tabId, message);
        browser.tabs
          .sendMessage(details.tabId, message, { frameId: 0 })
          .catch(() => {
            /* The tab may have navigated or closed. */
          });
      };
      filter.onerror = () => {
        try {
          filter.disconnect();
        } catch {
          /* The response stream can already be disconnected. */
        }
      };
    },
    {
      urls: [
        "https://www.wiki-masters.com/api/my-collection*",
        "https://wiki-masters.com/api/my-collection*",
      ],
      types: ["xmlhttprequest"],
    },
    ["blocking"],
  );
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "wm-ready" || !sender.tab || sender.frameId !== 0)
      return;
    try {
      if (!hosts.has(new URL(sender.url).hostname)) return;
    } catch {
      return;
    }
    return Promise.resolve(pages.get(sender.tab.id) ?? null);
  });
  browser.tabs.onRemoved.addListener((id) => {
    pages.delete(id);
    generations.delete(id);
    WMLockGuard.forget(id);
  });
  browser.tabs.onUpdated.addListener((id, change) => {
    if (change.status === "loading") {
      pages.delete(id);
      generations.delete(id);
    }
  });
})();
