const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const load = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const c = { URL, URLSearchParams, TextDecoder, Set, Object, JSON };
vm.createContext(c);
vm.runInContext(load("lock-policy.js"), c);
const policy = c.WMLockPolicy;
const cards = [
  { id: "card-a", rarity: "C", ownedId: "copy-a" },
  { id: "card-b", rarity: "R", ownedId: "copy-b" },
];
const locks = {
  [policy.key(cards[0])]: { id: "card-a", rarity: "C", ownedIds: ["copy-a"] },
};
const request = (body, route = "/api/marketplace", method = "POST") => ({
  url: "https://wiki-masters.com" + route,
  documentUrl: "https://wiki-masters.com/collection",
  method,
  requestBody: {
    raw: [{ bytes: new TextEncoder().encode(JSON.stringify(body)).buffer }],
  },
});
test("protect individual and mixed bulk removal using card or owned-copy IDs", () => {
  assert.equal(
    policy.blocked(request({ card_id: "card-a" }), locks, cards),
    true,
  );
  assert.equal(
    policy.blocked(
      request({ collection_id: "copy-a" }, "/api/discard"),
      locks,
      cards,
    ),
    true,
  );
  assert.equal(
    policy.blocked(
      request({ ids: ["copy-b", "copy-a"] }, "/api/discard"),
      locks,
      cards,
    ),
    true,
  );
  assert.equal(
    policy.blocked(
      request({}, "/api/marketplace/card-a", "DELETE"),
      locks,
      cards,
    ),
    true,
  );
  assert.equal(
    policy.blocked(request({ all: true }, "/api/discard"), locks, cards),
    true,
  );
});
test("unlocked cards and price reads stay available, no network is invoked", () => {
  assert.equal(
    policy.blocked(request({ card_id: "card-b" }), locks, cards),
    false,
  );
  assert.equal(
    policy.blocked(
      request({}, "/api/marketplace/cards/card-a/sales", "GET"),
      locks,
      cards,
    ),
    false,
  );
  assert.equal(
    policy.blocked(request({ card_id: "card-a" }), {}, cards),
    false,
  );
  const bid = request({ amount: 1 }, "/api/marketplace/listing/bid");
  bid.documentUrl = "https://wiki-masters.com/marketplace/listing";
  assert.equal(policy.blocked(bid, locks, cards), false);
});
test("saved copy IDs survive absent collection; new copies are protected", () => {
  assert.equal(policy.blocked(request({ id: "copy-a" }), locks, []), true);
  assert.equal(
    policy.blocked(request({ id: "new-copy" }), locks, [
      ...cards,
      { id: "card-a", rarity: "C", ownedId: "new-copy" },
    ]),
    true,
  );
  const form = request(null);
  form.requestBody = { formData: { ids: ["copy-a"] } };
  assert.equal(policy.blocked(form, locks, cards), true);
});
test("background persists locks, broadcasts and restores protection after reload", async () => {
  let saved = {},
    writes = 0;
  function background() {
    const callbacks = {};
    const context = {
      WMLockPolicy: policy,
      Map,
      Set,
      URL,
      Object,
      Promise,
      browser: {
        storage: {
          local: {
            get: async () => saved,
            set: async (value) => {
              saved = value;
              writes++;
            },
          },
        },
        runtime: {
          onMessage: { addListener: (fn) => (callbacks.message = fn) },
        },
        tabs: { query: async () => [], sendMessage: async () => {} },
        webRequest: {
          onBeforeRequest: { addListener: (fn) => (callbacks.request = fn) },
        },
      },
    };
    vm.createContext(context);
    vm.runInContext(load("locks-background.js"), context);
    return { context, callbacks };
  }
  const sender = {
    tab: { id: 1 },
    frameId: 0,
    url: "https://wiki-masters.com/collection",
  };
  const first = background();
  first.context.WMLockGuard.remember(1, cards);
  await first.callbacks.message(
    { type: "wm-set-locks", keys: [policy.key(cards[0])], locked: true },
    sender,
  );
  assert.equal(writes, 1);
  assert.equal(
    (await first.callbacks.request({ ...request({ id: "copy-a" }), tabId: 1 }))
      .cancel,
    true,
  );
  const second = background();
  await second.callbacks.message({ type: "wm-locks-ready" }, sender);
  assert.equal(
    (await second.callbacks.request({ ...request({ id: "copy-a" }), tabId: 1 }))
      .cancel,
    true,
  );
  second.context.WMFeatures = {
    whenReady: Promise.resolve(),
    enabled: () => false,
  };
  assert.equal(
    (await second.callbacks.request({ ...request({ id: "copy-a" }), tabId: 1 }))
      .cancel,
    false,
  );
  second.context.WMFeatures.enabled = () => true;
  assert.equal(
    (await second.callbacks.request({ ...request({ id: "copy-a" }), tabId: 1 }))
      .cancel,
    true,
  );
  await second.callbacks.message(
    { type: "wm-set-locks", keys: [policy.key(cards[0])], locked: false },
    sender,
  );
  assert.equal(
    (await second.callbacks.request({ ...request({ id: "copy-a" }), tabId: 1 }))
      .cancel,
    false,
  );
});
test("lock actions use native selection, including select all, without intercepting clicks", async () => {
  const handlers = {},
    messages = [];
  let queued, anchor;
  function element() {
    const classes = new Set();
    return {
      children: [],
      isConnected: true,
      textContent: "",
      listeners: {},
      attributes: {},
      classList: {
        add(name) {
          classes.add(name);
        },
        toggle(name, value) {
          if (value) classes.add(name);
          else classes.delete(name);
        },
        remove(...names) {
          names.forEach((name) => classes.delete(name));
        },
        contains: (name) => classes.has(name),
      },
      append(...items) {
        items.forEach((item) => {
          item.parentElement = this;
          this.children.push(item);
        });
      },
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      remove() {
        this.isConnected = false;
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      insertAdjacentElement(position, node) {
        this.inserted = node;
        node.previousElementSibling = this;
      },
    };
  }
  anchor = element();
  anchor.textContent = "Étiquettes";
  anchor.parentElement = {};
  anchor.className = "";
  const confirmation = element();
  confirmation.textContent = "Défausser";
  confirmation.parentElement = {};
  const context = {
    Map,
    Set,
    Object,
    JSON,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      observe() {}
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          messages.push(message);
          return { type: "wm-locks", locks: message.locked ? locks : {} };
        },
      },
    },
    document: {
      createElement: element,
      querySelectorAll: () =>
        anchor ? [confirmation, anchor] : [confirmation],
      addEventListener: (name, fn) => (handlers[name] = fn),
    },
  };
  vm.createContext(context);
  vm.runInContext(load("locks.js"), context);
  await new Promise(setImmediate);
  const first = element(),
    second = element(),
    checkA = {
      checked: false,
      getAttribute() {
        return null;
      },
    },
    checkB = {
      checked: false,
      getAttribute() {
        return null;
      },
    };
  first.querySelector = (selector) =>
    selector.startsWith("input") ? checkA : null;
  second.querySelector = (selector) =>
    selector.startsWith("input") ? checkB : null;
  context.WMLocks.card(first, cards[0]);
  context.WMLocks.card(second, cards[1]);
  queued();
  const [lockButton] = anchor.inserted.children;
  assert.equal(anchor.inserted.children.length, 2);
  assert.equal(lockButton.disabled, true);
  checkA.checked = true;
  checkB.checked = true;
  handlers.change();
  queued();
  assert.equal(lockButton.textContent, "Verrouiller (2)");
  lockButton.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(messages.at(-1).keys), cards.map(policy.key));
  assert.equal(checkA.checked, true);
  assert.equal(checkB.checked, true);
  checkB.checked = false;
  handlers.click();
  queued();
  assert.equal(lockButton.textContent, "Déverrouiller (1)");
  lockButton.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(messages.at(-1).keys), [policy.key(cards[0])]);
  assert.equal(confirmation.inserted, undefined);
  for (const label of [
    "Appliquer une étiquette",
    "Ajouter des étiquettes (2)",
    "Gérer les étiquettes",
    "Tout désélectionner",
    "Désélectionner (2)",
    "Retirer l'étiquette",
    "Retirer l’étiquette",
    "Tout sélectionner",
    "Tout sélectionner cette page",
  ]) {
    anchor.textContent = label;
    handlers.click();
    queued();
    assert.equal(
      anchor.inserted.isConnected,
      true,
      `lock action remains available beside ${label}`,
    );
    assert.equal(anchor.inserted.children[0].disabled, false);
  }
  context.getComputedStyle = () => ({ position: "static", bottom: "auto" });
  anchor.textContent = "Tout sélectionner";
  handlers.click();
  queued();
  assert.equal(
    anchor.inserted.isConnected,
    true,
    "selected cards keep their lock action in an inline native toolbar",
  );
  checkA.checked = false;
  handlers.change();
  queued();
  assert.equal(
    anchor.inserted.isConnected,
    false,
    "inline fallback requires a native selection",
  );
  checkA.checked = true;
  handlers.change();
  queued();
  assert.equal(anchor.inserted.isConnected, true);
  const menu = anchor.inserted;
  anchor = null;
  handlers.click();
  queued();
  assert.equal(menu.isConnected, false);
  assert.equal(confirmation.inserted, undefined);
});

test("single button follows committed React selection above DOM wrappers and toggles lock state", async () => {
  let queued, observeOptions;
  const handlers = {};
  let stored = {};
  function el() {
    const classes = new Set();
    return {
      isConnected: true,
      children: [],
      textContent: "",
      listeners: {},
      classList: {
        contains: (s) => classes.has(s),
        toggle(s, on) {
          if (on) classes.add(s);
          else classes.delete(s);
        },
        remove: (s) => classes.delete(s),
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      setAttribute() {},
      remove() {
        this.isConnected = false;
      },
      addEventListener(n, f) {
        this.listeners[n] = f;
      },
      append(...items) {
        this.children.push(...items);
      },
      insertAdjacentElement(_, node) {
        this.inserted = node;
        node.previousElementSibling = this;
      },
    };
  }
  const anchor = el();
  anchor.textContent = "Étiquettes";
  anchor.parentElement = {};
  anchor.className = "";
  const ctx = {
    Map,
    Set,
    Object,
    JSON,
    Array,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      observe(_, options) {
        observeOptions = options;
      }
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          if (message.type === "wm-set-locks")
            for (const id of message.keys) {
              if (message.locked) stored[id] = {};
              else delete stored[id];
            }
          return { type: "wm-locks", locks: { ...stored } };
        },
      },
    },
    document: {
      createElement: el,
      querySelectorAll: () => [anchor],
      addEventListener(n, f) {
        handlers[n] = f;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("locks.js"), ctx);
  await new Promise(setImmediate);
  const wrapper = el();
  const parent = el();
  wrapper.parentElement = parent;
  const rootA = { stateNode: {} },
    rootB = { stateNode: rootA.stateNode };
  rootA.alternate = rootB;
  rootB.alternate = rootA;
  const componentA = { memoizedProps: { isSelected: false }, return: rootA };
  const componentB = { memoizedProps: { isSelected: true }, return: rootB };
  const fiberA = { return: { stateNode: parent, return: componentA } },
    fiberB = { return: { stateNode: parent, return: componentB } };
  fiberA.alternate = fiberB;
  fiberB.alternate = fiberA;
  wrapper.wrappedJSObject = { __reactFiber$test: fiberA };
  rootA.stateNode.current = rootB;
  ctx.WMLocks.card(wrapper, cards[0]);
  queued();
  const button = anchor.inserted.children[0];
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Verrouiller (1)");
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.equal(button.textContent, "Déverrouiller (1)");
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.equal(button.textContent, "Verrouiller (1)");
  rootA.stateNode.current = rootA;
  handlers.click();
  queued();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Verrouiller (0)");
  assert.ok(observeOptions.attributeFilter.includes("class"));
});
test("actual collection checkmark enables the toggle; removing it clears selection", async () => {
  let queued, observer;
  const handlers = {};
  let stored = {};
  function el() {
    const classes = new Set();
    return {
      isConnected: true,
      children: [],
      textContent: "",
      listeners: {},
      classList: {
        contains: (s) => classes.has(s),
        toggle(s, on) {
          if (on) classes.add(s);
          else classes.delete(s);
        },
        remove: (s) => classes.delete(s),
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      setAttribute() {},
      remove() {
        this.isConnected = false;
      },
      addEventListener(n, f) {
        this.listeners[n] = f;
      },
      append(...items) {
        this.children.push(...items);
      },
      insertAdjacentElement(_, node) {
        this.inserted = node;
        node.previousElementSibling = this;
      },
    };
  }
  const anchor = el();
  anchor.textContent = "Étiquettes";
  anchor.parentElement = {};
  anchor.className = "";
  const ctx = {
    Map,
    Set,
    Object,
    JSON,
    Array,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      constructor(fn) {
        observer = fn;
      }
      observe() {}
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          if (message.type === "wm-set-locks")
            for (const id of message.keys) {
              if (message.locked) stored[id] = {};
              else delete stored[id];
            }
          return { type: "wm-locks", locks: { ...stored } };
        },
      },
    },
    document: {
      createElement: el,
      querySelectorAll: () => [anchor],
      addEventListener(n, f) {
        handlers[n] = f;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("locks.js"), ctx);
  await new Promise(setImmediate);
  const wrapper = el(),
    indicator = el();
  let check = null;
  // Native markup supplied by the user, outside the visual card face.
  indicator.className =
    "pointer-events-none absolute top-1.5 right-1.5 z-30 flex size-6 items-center justify-center rounded-md border-2 text-white shadow bg-[var(--color-accent)] border-[var(--color-accent)]";
  for (const name of indicator.className.split(" "))
    indicator.classList.toggle(name, true);
  indicator.matches = (s) =>
    s === 'span.pointer-events-none.absolute[aria-hidden="true"]';
  indicator.querySelector = (s) => (s === "svg.lucide-check" ? check : null);
  // A stale React flag must never override the actual visual checkbox.
  wrapper.wrappedJSObject = {
    __reactFiber$test: { memoizedProps: { isSelected: true } },
  };
  wrapper.append(indicator);
  ctx.WMLocks.card(wrapper, cards[0]);
  queued();
  const button = anchor.inserted.children[0];
  assert.equal(button.disabled, true);
  check = { className: "lucide lucide-check size-4" };
  observer([{ target: indicator }]);
  queued();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Verrouiller (1)");
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.equal(button.textContent, "Déverrouiller (1)");
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(setImmediate);
  assert.equal(button.textContent, "Verrouiller (1)");
  check = null;
  observer([{ target: indicator }]);
  queued();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Verrouiller (0)");
});
test("sell and discard are disabled for locked selections and restored on unlock", async () => {
  let queued, receive;
  const capture = {};
  function el(label = "") {
    const attrs = {},
      classes = new Set();
    return {
      isConnected: true,
      children: [],
      textContent: label,
      className: "",
      listeners: {},
      disabled: false,
      classList: {
        contains: (s) => classes.has(s),
        add: (s) => classes.add(s),
        toggle(s, on) {
          if (on) classes.add(s);
          else classes.delete(s);
        },
        remove: (s) => classes.delete(s),
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute(k, v) {
        attrs[k] = v;
      },
      removeAttribute: (k) => delete attrs[k],
      remove() {
        this.isConnected = false;
      },
      addEventListener(n, f) {
        this.listeners[n] = f;
      },
      append(...items) {
        this.children.push(...items);
      },
      insertAdjacentElement(_, node) {
        this.inserted = node;
        node.previousElementSibling = this;
      },
    };
  }
  const anchor = el("Tout sélectionner"),
    sell = el("Vendre"),
    discard = el("Défausser"),
    initiallyDisabled = el("Vendre");
  initiallyDisabled.disabled = true;
  const ctx = {
    Map,
    Set,
    Object,
    JSON,
    Array,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      observe() {}
    },
    browser: {
      runtime: {
        onMessage: {
          addListener(fn) {
            receive = fn;
          },
        },
        sendMessage: async () => ({ type: "wm-locks", locks }),
      },
    },
    document: {
      createElement: () => el(),
      querySelectorAll: () => [anchor, sell, discard, initiallyDisabled],
      addEventListener(n, fn, isCapture) {
        if (isCapture) capture[n] = fn;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("locks.js"), ctx);
  await new Promise(setImmediate);
  const a = el(),
    b = el(),
    checkA = {
      checked: false,
      getAttribute() {
        return null;
      },
    },
    checkB = {
      checked: true,
      getAttribute() {
        return null;
      },
    };
  a.querySelector = (s) => (s.startsWith("input") ? checkA : null);
  b.querySelector = (s) => (s.startsWith("input") ? checkB : null);
  ctx.WMLocks.card(a, cards[0]);
  ctx.WMLocks.card(b, cards[1]);
  queued();
  assert.equal(sell.disabled, false);
  assert.equal(discard.disabled, false);
  checkA.checked = true;
  ctx.WMLocks.card(a, cards[0]);
  queued();
  assert.equal(sell.disabled, true);
  assert.equal(discard.disabled, true);
  assert.equal(sell.getAttribute("aria-disabled"), "true");
  assert.equal(sell.classList.contains("wm-locked-action"), true);
  let stopped = false;
  capture.click({
    target: { closest: (s) => (s.startsWith("button") ? sell : null) },
    preventDefault() {},
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  receive({ type: "wm-locks", locks: {} });
  queued();
  assert.equal(sell.disabled, false);
  assert.equal(discard.disabled, false);
  assert.equal(initiallyDisabled.disabled, true);
  assert.equal(sell.classList.contains("wm-locked-action"), false);
  assert.equal(sell.getAttribute("aria-disabled"), null);
  // Direct card actions are protected even with no selected cards or toolbar.
  checkA.checked = checkB.checked = false;
  sell.closest = (s) => (s === "div.relative.isolate.group" ? a : null);
  receive({ type: "wm-locks", locks });
  queued();
  assert.equal(sell.disabled, true);
  assert.equal(discard.disabled, false);
});
test("provided auction/discard popup is protected even while selection controls remain mounted", async () => {
  let queued, receive;
  const capture = {};
  function el(label = "") {
    const attrs = {},
      classes = new Set();
    return {
      isConnected: true,
      children: [],
      textContent: label,
      className: "",
      listeners: {},
      disabled: false,
      classList: {
        contains: (s) => classes.has(s),
        add: (s) => classes.add(s),
        toggle(s, on) {
          if (on) classes.add(s);
          else classes.delete(s);
        },
        remove: (s) => classes.delete(s),
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      getAttribute: (k) => attrs[k] ?? null,
      setAttribute(k, v) {
        attrs[k] = v;
      },
      removeAttribute: (k) => delete attrs[k],
      remove() {
        this.isConnected = false;
      },
      addEventListener(n, f) {
        this.listeners[n] = f;
      },
      append(...items) {
        this.children.push(...items);
      },
      insertAdjacentElement(_, node) {
        this.inserted = node;
        node.previousElementSibling = this;
      },
    };
  }
  const anchor = el("Tout sélectionner"),
    auction = el("Mettre aux enchères"),
    discard = el("Défausser+1");
  for (const button of [auction, discard]) {
    button.classList.add("flex-1");
    button.querySelector = (selector) =>
      selector === "svg.lucide-gavel, svg.lucide-trash2, svg.lucide-trash-2"
        ? {}
        : null;
  }
  const ctx = {
    Map,
    Set,
    Object,
    JSON,
    Array,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      observe() {}
    },
    browser: {
      runtime: {
        onMessage: {
          addListener(fn) {
            receive = fn;
          },
        },
        sendMessage: async () => ({ type: "wm-locks", locks }),
      },
    },
    document: {
      createElement: () => el(),
      querySelectorAll: () => [anchor, auction, discard],
      addEventListener(n, fn, isCapture) {
        if (isCapture) capture[n] = fn;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("locks.js"), ctx);
  await new Promise(setImmediate);
  const lockedCard = el(),
    unlockedCard = el();
  ctx.WMLocks.card(lockedCard, cards[0]);
  ctx.WMLocks.card(unlockedCard, cards[1]);
  queued();
  const open = (wrapper) => {
    capture.click({
      target: {
        closest: (s) => (s === "div.relative.isolate.group" ? wrapper : null),
      },
    });
    queued();
  };
  open(lockedCard);
  assert.equal(auction.disabled, true);
  assert.equal(discard.disabled, true);
  assert.equal(auction.getAttribute("aria-disabled"), "true");
  assert.equal(discard.classList.contains("wm-locked-action"), true);
  let stopped = false;
  capture.click({
    target: { closest: (s) => (s.startsWith("button") ? auction : null) },
    preventDefault() {},
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  receive({ type: "wm-locks", locks: {} });
  queued();
  assert.equal(auction.disabled, false);
  assert.equal(discard.disabled, false);
  receive({ type: "wm-locks", locks });
  queued();
  assert.equal(auction.disabled, true);
  ctx.WMFeatures = { enabled: () => false };
  receive({ type: "wm-locks", locks });
  queued();
  assert.equal(auction.disabled, false);
  assert.equal(lockedCard.children[0].hidden, true);
  ctx.WMFeatures.enabled = () => true;
  receive({ type: "wm-locks", locks });
  queued();
  assert.equal(auction.disabled, true);
  assert.equal(lockedCard.children[0].hidden, false);
  // Opening another, unlocked card must not inherit the previous popup lock,
  // even if the locked card is still selected elsewhere in the collection.
  lockedCard.matches = () => true;
  open(unlockedCard);
  assert.equal(auction.disabled, false);
  assert.equal(discard.disabled, false);
});

test("lock icon is anchored under rarity on both collection and enlarged cards", async () => {
  let queued,
    receive,
    feature = true;
  function el(text = "") {
    const classes = new Set();
    return {
      children: [],
      isConnected: true,
      textContent: text,
      classList: {
        contains: (s) => classes.has(s),
        toggle(s, on) {
          if (on) classes.add(s);
          else classes.delete(s);
        },
        remove: (s) => classes.delete(s),
      },
      closest() {
        return null;
      },
      matches() {
        return false;
      },
      querySelector() {
        return null;
      },
      setAttribute() {},
      remove() {
        this.isConnected = false;
      },
      append(...items) {
        for (const item of items) {
          item.parentElement = this;
          this.children.push(item);
        }
      },
      addEventListener() {},
    };
  }
  const small = el(),
    smallRarity = el("SR"),
    largeRarity = el("SR");
  const largeFace = el();
  smallRarity.parentElement = small;
  largeFace.querySelector = () => ({
    textContent: "Scorpion (série télévisée)",
  });
  largeRarity.parentElement = largeFace;
  small.querySelector = (s) =>
    s === "div.absolute.top-2.left-2" ? smallRarity : null;
  smallRarity.closest = () => small;
  const item = {
    id: "scorpion",
    rarity: "SR",
    title: "Scorpion (série télévisée)",
  };
  const saved = {
    [JSON.stringify([item.id, item.rarity])]: {
      id: item.id,
      rarity: item.rarity,
    },
  };
  const ctx = {
    Map,
    Set,
    Object,
    JSON,
    Array,
    location: { pathname: "/collection" },
    getComputedStyle: () => ({ position: "fixed", bottom: "0px" }),
    setTimeout(fn) {
      queued = fn;
    },
    MutationObserver: class {
      observe() {}
    },
    WMFeatures: { enabled: () => feature, subscribe() {} },
    browser: {
      runtime: {
        onMessage: {
          addListener(fn) {
            receive = fn;
          },
        },
        sendMessage: async () => ({ type: "wm-locks", locks: saved }),
      },
    },
    document: {
      createElement: () => el(),
      addEventListener() {},
      querySelectorAll: (s) =>
        s === "div.absolute.top-2.left-2" ? [smallRarity, largeRarity] : [],
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("locks.js"), ctx);
  await new Promise(setImmediate);
  ctx.WMLocks.card(small, item);
  queued();
  assert.equal(smallRarity.children.length, 1);
  assert.equal(largeRarity.children.length, 1);
  assert.equal(smallRarity.children[0].hidden, false);
  assert.equal(largeRarity.children[0].hidden, false);
  ctx.WMLocks.card(small, item);
  queued();
  assert.equal(largeRarity.children.length, 1);
  feature = false;
  receive({ type: "wm-locks", locks: saved });
  queued();
  assert.equal(largeRarity.children[0].hidden, true);
  feature = true;
  receive({ type: "wm-locks", locks: {} });
  queued();
  assert.equal(smallRarity.children[0].hidden, true);
  assert.equal(largeRarity.children[0].hidden, true);
  const marker = largeRarity.children[0];
  largeFace.querySelector = () => ({ textContent: "Une autre carte" });
  ctx.WMLocks.card(small, item);
  queued();
  assert.equal(marker.isConnected, false);
});

test("labels can be applied to locked cards without allowing their sale or discard", () => {
  for (const route of [
    "/api/labels/apply",
    "/api/my-collection/bulk-label",
    "/api/cards/tags",
  ]) {
    assert.equal(
      policy.blocked(request({ card_id: "card-a" }, route), locks, cards),
      false,
    );
  }
  assert.equal(
    policy.blocked(
      request({ card_id: "card-a" }, "/api/marketplace/sell"),
      locks,
      cards,
    ),
    true,
  );
  assert.equal(
    policy.blocked(
      request({ card_id: "card-a" }, "/api/discard"),
      locks,
      cards,
    ),
    true,
  );
});

test("unrelated API writes referencing a protected card are not blocked", () => {
  for (const route of [
    "/api/profile",
    "/api/notifications",
    "/api/cards/wishlist",
    "/api/marketplace/listing/bid",
    "/api/marketplace/listing/buy",
    "/api/collection",
  ]) {
    assert.equal(
      policy.blocked(request({ card_id: "card-a" }, route), locks, cards),
      false,
      route,
    );
  }
});
test("storage failure only blocks removal operations, reports the issue and honors the off switch", async () => {
  const callbacks = {},
    sent = [];
  const context = {
    WMLockPolicy: policy,
    Map,
    Set,
    URL,
    Object,
    Promise,
    WMFeatures: { whenReady: Promise.resolve(), enabled: () => true },
    browser: {
      storage: {
        local: {
          get: async () => {
            throw Error("Storage unavailable");
          },
        },
      },
      runtime: { onMessage: { addListener: (fn) => (callbacks.message = fn) } },
      tabs: { sendMessage: async (id, msg) => sent.push(msg) },
      webRequest: {
        onBeforeRequest: { addListener: (fn) => (callbacks.request = fn) },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(load("locks-background.js"), context);
  assert.equal(
    (await callbacks.request({ ...request({}, "/api/profile"), tabId: 1 }))
      .cancel,
    false,
  );
  assert.equal(
    (await callbacks.request({ ...request({}, "/api/discard"), tabId: 1 }))
      .cancel,
    true,
  );
  assert.equal(sent.at(-1).type, "wm-locks-unavailable");
  context.WMFeatures.enabled = () => false;
  assert.equal(
    (await callbacks.request({ ...request({}, "/api/discard"), tabId: 1 }))
      .cancel,
    false,
  );
});
