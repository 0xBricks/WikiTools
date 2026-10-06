const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup() {
  let handler;
  const root = {
      buttons: [],
      querySelectorAll() {
        return this.buttons;
      },
    },
    dialogs = [];
  const ctx = {
    location: { pathname: "/pulls" },
    document: {
      querySelector: () => root,
      querySelectorAll: (s) =>
        s.startsWith('[role="dialog"]') ? dialogs : root.buttons,
      addEventListener: (name, fn) => (handler = fn),
    },
    getComputedStyle: (el) => ({
      display: el.display ?? "block",
      visibility: "visible",
      opacity: "1",
    }),
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "pulls-keyboard.js"), "utf8"),
    ctx,
  );
  function button(text = "", icon = "", attrs = {}) {
    const b = {
      textContent: text,
      isConnected: true,
      disabled: false,
      clicks: 0,
      getAttribute: (k) => attrs[k] ?? null,
      matches: () => false,
      getClientRects: () => [{}],
      closest: () => null,
      querySelector: (s) => (icon && s.includes("." + icon) ? {} : null),
      click() {
        this.clicks++;
      },
    };
    root.buttons.push(b);
    return b;
  }
  function key(key, extra = {}) {
    const event = {
      key,
      isTrusted: true,
      target: { closest: () => null },
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...extra,
    };
    handler(event);
    return event;
  }
  return { ctx, root, dialogs, button, key };
}
test("left/right activate native arrow buttons; Enter continues then opens", () => {
  const s = setup(),
    left = s.button("", "lucide-chevron-left"),
    right = s.button("", "lucide-chevron-right"),
    open = s.button("Ouvrir le paquet");
  assert.equal(s.key("ArrowLeft").prevented, true);
  assert.equal(left.clicks, 1);
  s.key("ArrowRight");
  assert.equal(right.clicks, 1);
  s.key("Enter");
  assert.equal(open.clicks, 1);
  const next = s.button("Continuer");
  s.key("Enter");
  assert.equal(next.clicks, 1);
  assert.equal(open.clicks, 1);
  next.disabled = true;
  open.disabled = true;
  s.key("Enter");
  assert.equal(next.clicks, 1);
  assert.equal(open.clicks, 1);
});
test("typing, modifiers, held keys and other pages never open packs", () => {
  const s = setup(),
    open = s.button("Ouvrir");
  s.key("Enter", { repeat: true });
  s.key("Enter", { ctrlKey: true });
  s.key("Enter", { isComposing: true });
  s.key("Enter", { isTrusted: false });
  s.key("Enter", {
    target: {
      closest: (selector) => (selector.startsWith("input") ? {} : null),
    },
  });
  s.key("Enter", { target: { isContentEditable: true } });
  s.ctx.location.pathname = "/collection";
  s.key("Enter");
  assert.equal(open.clicks, 0);
});
test("hidden, ambiguous and background actions are ignored", () => {
  const s = setup(),
    open = s.button("Ouvrir"),
    other = s.button("Ouvrir un paquet");
  s.key("Enter");
  assert.equal(open.clicks, 0);
  assert.equal(other.clicks, 0);
  other.display = "none";
  s.key("Enter");
  assert.equal(open.clicks, 1);
  const modal = {
    isConnected: true,
    closest: () => null,
    getClientRects: () => [{}],
    querySelectorAll: () => [],
  };
  s.dialogs.push(modal);
  s.key("Enter");
  assert.equal(open.clicks, 1);
});
test("Enter clicks a focused opening control once and preserves unrelated controls", () => {
  const s = setup(),
    open = s.button("Ouvrir"),
    close = s.button("Fermer");
  const focused = (b) => ({
    closest: (selector) => (selector.startsWith("button") ? b : null),
  });
  const event = s.key("Enter", { target: focused(open) });
  assert.equal(open.clicks, 1);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(s.key("Enter", { target: focused(close) }).prevented, false);
  assert.equal(open.clicks, 1);
});
test("Enter never activates the focused arrow; arrow keys do", () => {
  const s = setup(),
    left = s.button("", "lucide-chevron-left"),
    right = s.button("", "lucide-chevron-right");
  const focused = {
    closest: (selector) => (selector.startsWith("button") ? right : null),
  };
  const enter = s.key("Enter", { target: focused });
  assert.equal(enter.prevented, true);
  assert.equal(enter.stopped, true);
  assert.equal(right.clicks, 0);
  s.key("ArrowRight", { target: focused });
  assert.equal(right.clicks, 1);
  s.key("ArrowLeft", { target: focused });
  assert.equal(left.clicks, 1);
  const next = s.button("Continuer");
  s.key("Enter", { target: focused });
  assert.equal(next.clicks, 1);
  assert.equal(right.clicks, 1);
});
test("plain SVG chevrons work outside main without icon classes", () => {
  const s = setup(),
    left = s.button(),
    right = s.button();
  left.querySelectorAll = () => [
    { getAttribute: (name) => (name === "d" ? "m15 18-6-6 6-6" : null) },
  ];
  right.querySelectorAll = () => [
    { getAttribute: (name) => (name === "points" ? "9 6 15 12 9 18" : null) },
  ];
  s.key("ArrowLeft");
  s.key("ArrowRight");
  assert.equal(left.clicks, 1);
  assert.equal(right.clicks, 1);
  const focused = {
    closest: (selector) => (selector.startsWith("button") ? right : null),
  };
  assert.equal(s.key("Enter", { target: focused }).prevented, true);
  assert.equal(right.clicks, 1);
});
test("Enter opens in main even when another opening button exists outside it", () => {
  const s = setup(),
    open = s.button("Ouvrir le paquet", "lucide-chevron-right");
  const outside = s.button("Ouvrir");
  s.root.buttons.pop();
  s.ctx.document.querySelectorAll = (selector) =>
    selector.startsWith('[role="dialog"]') ? [] : [...s.root.buttons, outside];
  s.key("Enter");
  assert.equal(open.clicks, 1);
  assert.equal(outside.clicks, 0);
  s.key("ArrowRight");
  assert.equal(open.clicks, 1);
});
test("Enter opens the next pack after focus remains on a disabled Continue button", () => {
  const s = setup(),
    next = s.button("Continuer"),
    open = s.button("Ouvrir le paquet");
  next.disabled = true;
  const focused = {
    closest: (selector) => (selector.startsWith("button") ? next : null),
  };
  s.key("Enter", { target: focused });
  assert.equal(open.clicks, 1);
  assert.equal(next.clicks, 0);
});

test("disabled keyboard feature leaves native key events untouched", () => {
  const s = setup(),
    open = s.button("Ouvrir"),
    arrow = s.button("", "lucide-chevron-right");
  s.ctx.WMFeatures = { enabled: () => false };
  assert.equal(s.key("Enter").prevented, false);
  assert.equal(s.key("ArrowRight").prevented, false);
  assert.equal(open.clicks, 0);
  assert.equal(arrow.clicks, 0);
  s.ctx.WMFeatures.enabled = () => true;
  s.key("Enter");
  assert.equal(open.clicks, 1);
});
