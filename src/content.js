/* Local collection tools: only observe collection data already loaded by the site. */
(() => {
  "use strict";
  let cards = new Map(),
    generation = -1,
    scheduled = false,
    toolbar,
    onCollection = false;
  function receive(message) {
    if (
      message?.type !== "wm-collection" ||
      !Array.isArray(message.cards) ||
      message.generation < generation
    )
      return;
    generation = message.generation;
    cards = WMCollection.index(message.cards);
    schedule();
  }
  browser.runtime.onMessage.addListener(receive);
  browser.runtime
    .sendMessage({ type: "wm-ready" })
    .then(receive)
    .catch(() => {
      /* A later native collection response will retry identification. */
    });
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      sync();
    }, 100);
  }
  function sync() {
    if (!document.body) return;
    if (!toolbar?.isConnected) {
      toolbar = document.createElement("div");
      toolbar.className = "wm-toolbar";
      WMMenu.mount(toolbar);
      document.body.append(toolbar);
    }
    if (!/^\/collection\/?$/.test(location.pathname)) {
      if (onCollection) {
        globalThis.WMLocks?.leave();
        cards.clear();
        generation = -1;
      }
      onCollection = false;
      return;
    }
    onCollection = true;
    const heading = [...document.querySelectorAll("h1")].find(
      (h) => h.textContent.trim() === "Collection",
    );
    if (!heading) return;
    for (const wrapper of document.querySelectorAll(
      "div.relative.isolate.group",
    )) {
      const title = wrapper.querySelector("h3"),
        face = title?.parentElement?.parentElement;
      if (!title || !face?.classList.contains("cursor-pointer")) continue;
      const rarity = [...face.querySelectorAll("div.absolute.top-2.left-2")]
        .map((e) => e.textContent.trim())
        .find((t) => WMCollection.rarities.has(t));
      const card = cards.get(WMCollection.key(title.textContent, rarity));
      if (card) globalThis.WMLocks?.card(wrapper, card);
      else globalThis.WMLocks?.remove(wrapper);
    }
  }
  globalThis.WMFeatures?.subscribe(schedule);
  WMPageEvents.subscribe(schedule);
  schedule();
})();
