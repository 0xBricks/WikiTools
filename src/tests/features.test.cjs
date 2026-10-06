const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = (name) =>
  fs.readFileSync(path.join(__dirname, "..", name), "utf8");
function settingsStore() {
  const data = { cardLocks: { kept: true } },
    listeners = [];
  let fail = false;
  const browser = {
    storage: {
      onChanged: { addListener: (fn) => listeners.push(fn) },
      local: {
        get: async () => ({ ...data }),
        set: async (values) => {
          if (fail) throw Error("Storage failure");
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
          }
          for (const listener of listeners) listener(changes, "local");
        },
      },
    },
  };
  function context(extra = {}) {
    const ctx = { browser, Set, Object, ...extra };
    vm.createContext(ctx);
    vm.runInContext(source("features.js"), ctx);
    return ctx;
  }
  return { context, data, fail: () => (fail = true) };
}

test("retained settings persist and removed options cannot be reactivated", async () => {
  const store = settingsStore(),
    a = store.context(),
    b = store.context();
  await Promise.all([a.WMFeatures.whenReady, b.WMFeatures.whenReady]);
  for (const key of [
    "locks",
    "market",
    "multiLabels",
    "fullArt",
    "pullsKeyboard",
  ])
    assert.equal(a.WMFeatures.enabled(key), true);
  for (const key of [
    "collectionCache",
    "scan",
    "marketWishlist",
    "marketSlow",
    "marketNotifications",
  ]) {
    assert.equal(a.WMFeatures.enabled(key), false);
    await assert.rejects(a.WMFeatures.set(key, true), /Option inconnue/);
  }
  await a.WMFeatures.set("locks", false);
  assert.equal(b.WMFeatures.enabled("locks"), false);
  await a.WMFeatures.set("fullArt", false);
  assert.equal(b.WMFeatures.enabled("fullArt"), false);
  const reloaded = store.context();
  await reloaded.WMFeatures.whenReady;
  assert.equal(reloaded.WMFeatures.enabled("fullArt"), false);
  assert.equal(store.data.cardLocks.kept, true);
  store.fail();
  await assert.rejects(a.WMFeatures.set("market", false));
  assert.equal(a.WMFeatures.enabled("market"), true);
});
test("menu exposes only the five available options", async () => {
  function element(tag) {
    return {
      tag,
      children: [],
      isConnected: true,
      listeners: {},
      attrs: {},
      textContent: "",
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      addEventListener(k, v) {
        this.listeners[k] = v;
      },
      append(...items) {
        this.children.push(...items);
      },
    };
  }
  const ctx = settingsStore().context({ document: { createElement: element } });
  await ctx.WMFeatures.whenReady;
  vm.runInContext(source("menu.js"), ctx);
  const toolbar = element("div");
  ctx.WMMenu.mount(toolbar);
  await new Promise(setImmediate);
  const body = toolbar.children[0].children[1],
    labels = body.children.filter((n) => n.tag === "label");
  assert.equal(labels.length, 5);
  assert.deepEqual(
    labels.map((n) => n.children[0].children[0].textContent),
    [
      "Cadenas",
      "Marché",
      "Multi-étiquettes",
      "Raccourcis clavier",
      "Apparence des cartes",
    ],
  );
  for (const label of labels) {
    const input = label.children[1];
    assert.equal(input.checked, true);
    assert.equal(input.disabled, false);
  }
});
test("packaged scripts exclude direct price and wishlist clients", () => {
  const manifest = JSON.parse(source("manifest.json"));
  for (const file of [
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((c) => c.js),
  ]) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", file)));
    assert.doesNotMatch(
      file,
      /collection-cache|wishlist|prefetch|market-search|market-native|market-notifications/,
    );
    assert.doesNotMatch(source(file), /await fetch\(|fetchJSON|client\.from\(/);
  }
});
