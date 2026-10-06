const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../full-art.js"), "utf8");
function harness(saved = {}) {
  const timers = [],
    writes = [];
  const host = {
    children: [],
    append(n) {
      this.children.push(n);
      n.isConnected = true;
    },
  };
  function element() {
    return {
      dataset: {},
      isConnected: false,
      children: [],
      value: "",
      checked: false,
      disabled: false,
      style: { setProperty() {} },
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      setAttribute() {},
      getAttribute() {
        return null;
      },
      removeAttribute() {},
      closest() {
        return null;
      },
      focus() {},
      listeners: {},
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      append(...n) {
        this.children.push(...n);
      },
      replaceChildren(...n) {
        this.children = n;
      },
      querySelector(selector) {
        return (this.controls[selector] ||= element());
      },
      querySelectorAll() {
        return [];
      },
      controls: {},
      remove() {
        this.isConnected = false;
      },
    };
  }
  const document = {
    addEventListener() {},
    body: {},
    querySelector: (s) => (s === ".wm-tools-body" ? host : null),
    querySelectorAll: () => [],
    createElement: element,
  };
  const context = {
    document,
    location: { pathname: "/collection" },
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    setInterval() {},
    addEventListener() {},
    MutationObserver: class {
      observe() {}
    },
    browser: {
      storage: {
        local: {
          get: async () => ({ wmFullArt: saved }),
          set: async (value) => {
            writes.push(JSON.parse(JSON.stringify(value)));
          },
        },
      },
    },
  };
  vm.createContext(context);
  // Expose the closure only in the test realm; the production module stays private.
  vm.runInContext(
    source.replace(
      /\}\)\(\);\s*$/,
      "globalThis.testAPI={sanitize,scan,updateCard,appearance,framing,candidatesOnPage,setPicking,chooseCard,selectForTest(key){selectedCard=key;selectedLabel=key;scan()}};})();",
    ),
    context,
  );
  return { context, host, writes };
}
test("Full Art mounts inside the shared menu without changing cards by default", async () => {
  const h = harness();
  await new Promise(setImmediate);
  assert.equal(h.host.children.length, 1);
  assert.equal(h.host.children[0].className, "wmfa-panel");
  assert.equal(h.context.testAPI.appearance("test").full, undefined);
  h.context.testAPI.scan();
  assert.equal(h.host.children.length, 1);
  h.context.location.pathname = "/other";
  h.context.testAPI.scan();
  assert.equal(h.host.children[0].isConnected, false);
});
test("Full Art retains local images and per-card settings while rejecting remote image settings", async () => {
  const h = harness({
    cards: {
      a: { full: true, customImage: "https://example.com/image.jpg" },
      b: {
        full: true,
        customImage: "data:image/png;base64,AA",
        haloColor: "#123456",
      },
    },
  });
  await new Promise(setImmediate);
  assert.equal(h.context.testAPI.appearance("a").customImage, null);
  assert.equal(
    h.context.testAPI.appearance("b").customImage,
    "data:image/png;base64,AA",
  );
  h.context.testAPI.updateCard("a", { full: false, haloColor: "#abcdef" });
  assert.equal(h.writes.at(-1).wmFullArt.cards.a.full, false);
  assert.equal(h.writes.at(-1).wmFullArt.cards.b.full, true);
  assert.equal(h.writes.at(-1).wmFullArt.cards.b.haloColor, "#123456");
});

test("all six rarities are discovered and unrelated headings are ignored", async () => {
  const h = harness();
  await new Promise(setImmediate);
  const cards = ["C", "PC", "R", "SR", "UR", "L"].map((r) => ({
    querySelector: () => ({}),
    querySelectorAll: () => [{ textContent: r }],
  }));
  const headings = cards.map((card) => ({
    parentElement: { parentElement: card },
  }));
  headings.push({
    parentElement: { parentElement: { querySelector: () => null } },
  });
  h.context.document.querySelectorAll = () => headings;
  const result = h.context.testAPI.candidatesOnPage();
  assert.equal(result.length, 6);
  for (const card of cards) assert.ok(result.includes(card));
});
test("image import reports invalid files and saves a decoded local image to the chosen card", async () => {
  const h = harness({ cards: { a: { full: false } } });
  await new Promise(setImmediate);
  h.context.WMImageTools = {
    prepare: async (file) => {
      if (file.type !== "image/png") throw new Error("image valide attendue");
      return "data:image/png;base64,AA";
    },
  };
  h.context.testAPI.selectForTest("a");
  const panel = h.host.children[0],
    input = panel.querySelector('input[name="photo"]'),
    status = panel.querySelector("[data-photo-status]");
  await input.listeners.change({
    target: { files: [{ type: "text/plain" }], value: "bad" },
  });
  assert.match(status.textContent, /image valide/);
  assert.equal(h.writes.length, 0);
  input.listeners.change({
    target: { files: [{ type: "image/png" }], value: "image" },
  });
  await new Promise(setImmediate);
  assert.equal(
    h.writes.at(-1).wmFullArt.cards.a.customImage,
    "data:image/png;base64,AA",
  );
  assert.equal(panel.querySelector("[data-photo-preview]").hidden, false);
  assert.match(status.textContent, /enregistrée/);
});

test("direct selection intercepts only the chosen card while selection mode is active", async () => {
  const h = harness();
  await new Promise(setImmediate);
  const classes = new Set(),
    target = {},
    heading = { textContent: "Carte commune" };
  const card = {
    children: [],
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    contains: (n) => n === target,
    querySelector: (s) => (s === "h3" ? heading : {}),
    querySelectorAll: () => [{ textContent: "C" }],
  };
  heading.parentElement = { parentElement: card };
  h.context.document.querySelectorAll = () => [heading];
  h.context.getComputedStyle = () => ({});
  let prevented = 0;
  const event = {
    target,
    button: 0,
    preventDefault() {
      prevented++;
    },
    stopImmediatePropagation() {},
  };
  h.context.testAPI.chooseCard(event);
  assert.equal(prevented, 0);
  h.context.testAPI.setPicking(true);
  assert.equal(classes.has("wmfa-pickable"), true);
  h.context.testAPI.chooseCard(event);
  assert.equal(prevented, 1);
  assert.equal(classes.has("wmfa-pickable"), false);
  assert.equal(
    h.host.children[0].querySelector("[data-selected-card]").textContent,
    "Carte commune",
  );
  assert.equal(
    h.host.children[0].querySelector("[data-card-editor]").hidden,
    false,
  );
  h.context.testAPI.chooseCard(event);
  assert.equal(prevented, 1);
  h.context.testAPI.setPicking(true);
  h.context.testAPI.setPicking(false);
  assert.equal(classes.size, 0);
});

test("global switch removes the editor and restores it without clearing personalizations", async () => {
  const h = harness({
    cards: { a: { full: true, customImage: "data:image/png;base64,AA" } },
  });
  await new Promise(setImmediate);
  let active = false;
  h.context.WMFeatures = { enabled: () => active };
  h.context.testAPI.scan();
  assert.equal(h.host.children[0].isConnected, false);
  assert.equal(h.context.testAPI.appearance("a").full, true);
  assert.equal(h.writes.length, 0);
  active = true;
  h.context.testAPI.scan();
  assert.equal(h.host.children.at(-1).isConnected, true);
  assert.equal(
    h.context.testAPI.appearance("a").customImage,
    "data:image/png;base64,AA",
  );
});

test("halo and framing are saved per card and survive global effects changes", async () => {
  const h = harness({
    focus: 40,
    focusX: 60,
    cards: {
      a: { full: true },
      b: { full: true, customImage: "data:image/png;base64,AA" },
    },
  });
  await new Promise(setImmediate);
  h.context.testAPI.selectForTest("a");
  const panel = h.host.children[0];
  assert.equal(h.context.testAPI.framing("a").focus, 40);
  for (const [name, value] of [
    ["focus", 75],
    ["focusX", 20],
    ["zoom", 180],
  ])
    panel.listeners.input({ target: { name, value } });
  panel.listeners.input({ target: { name: "haloEnabled", checked: false } });
  panel.listeners.input({
    target: { name: "effect", type: "select", value: "gold" },
  });
  assert.equal(h.writes.at(-1).wmFullArt.cards.a.haloEnabled, false);
  assert.equal(h.writes.at(-1).wmFullArt.cards.a.zoom, 180);
  assert.equal(h.context.testAPI.framing("b").zoom, 100);
  assert.equal(h.context.testAPI.framing("b").focus, 40);
  panel.listeners.input({ target: { name: "haloEnabled", checked: true } });
  assert.equal(h.writes.at(-1).wmFullArt.cards.a.haloEnabled, true);
  panel.querySelector('[data-action="reset-framing"]').listeners.click();
  assert.equal(h.context.testAPI.framing("a").focus, 30);
  assert.equal(h.context.testAPI.framing("a").zoom, 100);
});

test("legacy prototype photo migrates once without overriding an existing per-card image", async () => {
  const legacy = "data:image/png;base64,OLD",
    current = "data:image/png;base64,NEW";
  const a = harness({ customImage: legacy });
  await new Promise(setImmediate);
  assert.equal(
    a.context.testAPI.appearance("guillaume pley").customImage,
    legacy,
  );
  assert.equal(a.writes.at(-1).wmFullArt.customImage, undefined);
  const b = harness({
    customImage: legacy,
    cards: { "guillaume pley": { full: true, customImage: current } },
  });
  await new Promise(setImmediate);
  assert.equal(
    b.context.testAPI.appearance("guillaume pley").customImage,
    current,
  );
});
