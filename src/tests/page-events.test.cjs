const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
test("page observer batches updates and idle route checks do not trigger scans", () => {
  let mutation, interval;
  const timers = [],
    events = {};
  const ctx = {
    location: { href: "https://wiki-masters.com/collection" },
    document: { hidden: false, addEventListener: (n, f) => (events[n] = f) },
    window: {
      addEventListener: (n, f) => (events[n] = f),
      wrappedJSObject: {},
    },
    MutationObserver: class {
      constructor(fn) {
        mutation = fn;
      }
      observe() {}
    },
    setTimeout: (fn) => timers.push(fn),
    setInterval: (fn) => {
      interval = fn;
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../page-events.js"), "utf8"),
    ctx,
  );
  let scans = 0;
  ctx.WMPageEvents.subscribe(() => scans++);
  interval();
  interval();
  assert.equal(timers.length, 0);
  mutation([{ target: { closest: () => true } }]);
  assert.equal(timers.length, 0);
  mutation([{ target: {} }]);
  mutation([{ target: {} }]);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(scans, 1);
  ctx.location.href = "https://wiki-masters.com/profile/a";
  interval();
  timers.shift()();
  assert.equal(scans, 2);
  ctx.document.hidden = true;
  ctx.location.href = "https://wiki-masters.com/pulls";
  interval();
  assert.equal(timers.length, 0);
  ctx.document.hidden = false;
  events.visibilitychange();
  timers.shift()();
  assert.equal(scans, 3);
  ctx.window.wrappedJSObject.next = { router: { push() {}, replace() {} } };
  interval();
  timers.shift()();
  assert.equal(scans, 4);
});
