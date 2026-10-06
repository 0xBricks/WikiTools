(() => {
  "use strict";
  const names = ["locks", "market", "multiLabels", "fullArt", "pullsKeyboard"],
    values = {},
    listeners = new Set();
  let loaded = false;
  const storageKey = (name) => `wm-feature-${name}`;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const whenReady = browser.storage.local
    .get(names.map(storageKey))
    .then((data) => {
      for (const name of names) values[name] = data[storageKey(name)] !== false;
      loaded = true;
      notify();
    });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let changed = false;
    for (const name of names)
      if (storageKey(name) in changes) {
        values[name] = changes[storageKey(name)].newValue !== false;
        changed = true;
      }
    if (loaded && changed) notify();
  });
  globalThis.WMFeatures = Object.freeze({
    whenReady,
    enabled: (name) => loaded && values[name] === true,
    subscribe(listener) {
      listeners.add(listener);
    },
    async set(name, enabled) {
      if (!names.includes(name) || typeof enabled !== "boolean")
        throw new Error("Option inconnue");
      await whenReady;
      await browser.storage.local.set({ [storageKey(name)]: enabled });
      values[name] = enabled;
      notify();
    },
  });
})();
