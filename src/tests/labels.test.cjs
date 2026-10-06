const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const load = (name) =>
  fs.readFileSync(path.join(__dirname, "..", name), "utf8");
function batchContext(fetch) {
  const events = {};
  let backgroundMessage, expire;
  const permissions = JSON.parse(load("manifest.json")).permissions.filter(
    (p) => p.startsWith("https://"),
  );
  const matches = (url, pattern) =>
    new RegExp(
      "^" +
        pattern
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    ).test(url);
  const listen = (name) => ({
    addListener(fn, filter) {
      events[name] = (details) => {
        if (
          permissions.some((pattern) => matches(details.url, pattern)) &&
          filter.urls.some((pattern) => matches(details.url, pattern))
        )
          return fn(details);
      };
    },
  });
  const sender = {
    tab: { id: 1 },
    frameId: 0,
    url: "https://wiki-masters.com/collection",
  };
  const background = {
    Map,
    Set,
    Promise,
    URL,
    clearTimeout,
    setTimeout(fn, ms) {
      if (ms === 20000) {
        expire = fn;
        return 0;
      }
      return setTimeout(fn, 0);
    },
    browser: {
      runtime: {
        onMessage: {
          addListener(fn) {
            backgroundMessage = fn;
          },
        },
      },
      tabs: { onRemoved: { addListener() {} } },
      webRequest: {
        onBeforeRequest: listen("before"),
        onCompleted: listen("completed"),
        onErrorOccurred: listen("error"),
      },
    },
  };
  vm.createContext(background);
  vm.runInContext(load("label-watch-background.js"), background);
  let requestId = 0;
  const network = async (url, options = {}) => {
    const details = {
      tabId: 1,
      requestId: String(++requestId),
      url: new URL(url, "https://wiki-masters.com").href,
      method: options.method ?? "GET",
    };
    events.before(details);
    try {
      const response = await fetch(url, options);
      events.completed({ ...details, statusCode: response.status ?? 200 });
      return response;
    } catch (error) {
      events.error(details);
      throw error;
    }
  };
  const page = { fetch: network };
  const ctx = {
    window: { wrappedJSObject: page },
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    originalFetch: network,
    expire: () => expire(),
    browser: {
      runtime: { sendMessage: (message) => backgroundMessage(message, sender) },
    },
    location: {
      origin: "https://wiki-masters.com",
      href: "https://wiki-masters.com/collection",
      pathname: "/collection",
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("label-batch.js"), ctx);
  return { ctx, page, events };
}
test("native label actions run sequentially, exactly once, and original fetch is restored", async () => {
  const sent = [];
  let inFlight = 0;
  const native = async (url) => {
    assert.equal(inFlight, 0);
    inFlight++;
    sent.push(url);
    await new Promise(setImmediate);
    inFlight--;
    return { ok: true, status: 200 };
  };
  const { ctx, page } = batchContext(native);
  const jobs = ["collection", "vente"].map((name) => ({
    name,
    run: () => page.fetch("/api/labels/" + name, { method: "POST" }),
  }));
  assert.equal(sent.length, 0);
  assert.equal(await ctx.WMLabelBatch.apply(jobs), 2);
  assert.deepEqual(sent, ["/api/labels/collection", "/api/labels/vente"]);
  assert.equal(page.fetch, ctx.originalFetch);
});
test("HTTP refusal stops the batch even when the native handler catches the error", async () => {
  const sent = [];
  const native = async (url) => {
    sent.push(url);
    return { ok: sent.length === 1, status: sent.length === 1 ? 200 : 403 };
  };
  const { ctx, page } = batchContext(native);
  const jobs = ["a", "b", "c"].map((name) => ({
    name,
    run: async () => {
      await page.fetch("/api/labels/" + name, { method: "PATCH" });
    },
  }));
  await assert.rejects(
    ctx.WMLabelBatch.apply(jobs),
    (error) => error.completed === 1 && /403/.test(error.message),
  );
  assert.equal(sent.length, 2);
  assert.equal(page.fetch, ctx.originalFetch);
});
test("unconfirmed actions do not count as success or start the next label", async () => {
  let second = false;
  const native = async () => ({ ok: true });
  const { ctx, page } = batchContext(native);
  const task = ctx.WMLabelBatch.apply([
    { name: "a", run() {} },
    {
      name: "b",
      run() {
        second = true;
      },
    },
  ]);
  await new Promise(setImmediate);
  ctx.expire();
  await assert.rejects(task, (error) => error.completed === 0);
  assert.equal(second, false);
  assert.equal(page.fetch, ctx.originalFetch);
});
function ui(cards = [], native = () => {}) {
  const clickHandlers = [];
  let queued,
    enabled = true,
    changed;
  const calls = [];
  function element(text = "") {
    const classes = new Set(),
      attrs = {};
    return {
      textContent: text,
      children: [],
      isConnected: true,
      disabled: false,
      listeners: {},
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      getAttribute: (name) => attrs[name] ?? null,
      setAttribute(name, value) {
        attrs[name] = value;
      },
      removeAttribute(name) {
        delete attrs[name];
      },
      append(...items) {
        for (const item of items) {
          item.parentElement = this;
          this.children.push(item);
        }
      },
      remove() {
        this.isConnected = false;
      },
      closest() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getClientRects() {
        return [{}];
      },
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      },
      click() {
        return this.listeners.click?.({
          preventDefault() {},
          stopPropagation() {},
        });
      },
    };
  }
  const root = element(),
    list = element(),
    heading = element("Appliquer une étiquette"),
    input = element(),
    exit = element("Annuler la sélection");
  heading.parentElement = root;
  const close = element();
  close.listeners.click = () => {
    root.isConnected = false;
  };
  exit.listeners.click = () => calls.push("exit");
  const rows = ["collection", "evil slop", "gaspar noé", "vente"].map(
    (name) => {
      const row = element(name);
      row.querySelector = () => ({ textContent: name });
      row.closest = (s) => (s === "button" ? row : null);
      row.wrappedJSObject = {
        __reactProps$fixture: {
          onClick: () => {
            calls.push(name);
            return native(name);
          },
        },
      };
      row.listeners.click = row.wrappedJSObject.__reactProps$fixture.onClick;
      return row;
    },
  );
  list.querySelectorAll = () => rows;
  root.querySelector = (s) =>
    s.startsWith("input")
      ? input
      : s === "div.max-h-64.overflow-y-auto"
        ? list
        : s === 'button[aria-label="Fermer"]'
          ? close
          : null;
  const ctx = {
    Map,
    Set,
    Object,
    Array,
    Promise,
    location: { pathname: "/collection" },
    setTimeout(fn) {
      queued = fn;
    },
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class {
      observe() {}
    },
    WMFeatures: {
      enabled: () => enabled,
      subscribe(fn) {
        changed = fn;
      },
    },
    WMLabelBatch: {
      apply: async (jobs) => {
        for (const job of jobs) await job.run();
        return jobs.length;
      },
    },
    document: {
      body: element(),
      createElement: () => element(),
      querySelectorAll: (s) =>
        s === "h2" && root.isConnected
          ? [heading]
          : s === "button"
            ? [exit]
            : s === "div.relative.isolate.group"
              ? cards
              : [],
      addEventListener(type, fn, capture) {
        if (type === "click" && capture) clickHandlers.push(fn);
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(load("labels.js"), ctx);
  queued();
  const pick = (row) => {
    let stopped = false;
    for (const fn of clickHandlers)
      fn({
        target: row,
        preventDefault() {},
        stopImmediatePropagation() {
          stopped = true;
        },
      });
    return stopped;
  };
  return {
    ctx,
    calls,
    root,
    rows,
    footer: root.children[0],
    pick,
    setEnabled(value) {
      enabled = value;
      changed();
      queued();
    },
  };
}
test("checkboxes apply native actions and leave the native popup open", async () => {
  const s = ui();
  assert.equal(s.pick(s.rows[0]), true);
  s.pick(s.rows[3]);
  assert.equal(s.calls.length, 0);
  assert.equal(s.rows[0].getAttribute("aria-checked"), "true");
  assert.equal(s.footer.children[1].textContent, "Appliquer (2)");
  await s.footer.children[1].click();
  assert.deepEqual(s.calls, ["collection", "vente"]);
  assert.equal(s.root.isConnected, true);
});
test("partial label failure leaves selection active and shows an error", async () => {
  const s = ui();
  s.pick(s.rows[0]);
  s.pick(s.rows[1]);
  s.ctx.WMLabelBatch.apply = async () => {
    const error = Error("Refus");
    error.completed = 1;
    throw error;
  };
  await s.footer.children[1].click();
  assert.equal(s.calls.includes("exit"), false);
  assert.equal(s.root.isConnected, true);
  const overlay = s.ctx.document.body.children[0];
  assert.match(overlay.children[0].children[0].textContent, /1\/2.*Refus/);
  assert.equal(s.footer.hidden, false);
});

test("requests sent later through a cached client are observed without patching fetch", async () => {
  const { ctx, page } = batchContext(async () => ({ ok: true, status: 204 }));
  const cached = page.fetch;
  const count = await ctx.WMLabelBatch.apply([
    {
      name: "label",
      run() {
        setTimeout(() => cached("/api/labels/apply", { method: "POST" }), 1);
      },
    },
  ]);
  assert.equal(count, 1);
  assert.equal(page.fetch, cached);
});
test("unrelated GET requests cannot confirm a label application", async () => {
  const { ctx, page } = batchContext(async () => ({ ok: true, status: 200 }));
  const task = ctx.WMLabelBatch.apply([
    { name: "label", run: () => page.fetch("/api/my-collection") },
  ]);
  await new Promise(setImmediate);
  ctx.expire();
  await assert.rejects(task, (error) => error.completed === 0);
});

test("visible native success advances the batch when no request is attributed to the tab", async () => {
  const { ctx } = batchContext(async () => {
    throw Error("No request expected");
  });
  const sent = [];
  let visible = "";
  const jobs = ["collection", "vente"].map((name) => ({
    name,
    run() {
      sent.push(name);
      visible = name;
    },
    confirmed: () => visible === name,
  }));
  assert.equal(await ctx.WMLabelBatch.apply(jobs), 2);
  assert.deepEqual(sent, ["collection", "vente"]);
});

test("visible labels never override an observed HTTP failure", async () => {
  const { ctx, page } = batchContext(async () => ({ status: 403 }));
  await assert.rejects(
    ctx.WMLabelBatch.apply([
      {
        name: "collection",
        run: () => page.fetch("/api/labels", { method: "POST" }),
        confirmed: () => true,
      },
    ]),
    (error) => error.completed === 0 && /403/.test(error.message),
  );
});

test("DOM confirmation requires the closed popup and the label on every selected card", async () => {
  function card(title) {
    const labels = [];
    return {
      labels,
      children: [
        {
          matches: () => true,
          classList: { contains: () => true },
          querySelector: () => ({}),
        },
      ],
      querySelector: (s) => ({ textContent: s === "h3" ? title : "SR" }),
      querySelectorAll: () => labels.map((textContent) => ({ textContent })),
    };
  }
  const cards = [card("A"), card("B")],
    s = ui(cards);
  s.pick(s.rows[0]);
  s.ctx.WMLabelBatch.apply = async (jobs) => {
    const job = jobs[0];
    assert.equal(job.confirmed(), false);
    cards[0].labels.push("collection");
    s.root.isConnected = false;
    assert.equal(job.confirmed(), false);
    cards[1].labels.push("collection");
    assert.equal(job.confirmed(), true);
    s.root.isConnected = true;
    assert.equal(job.confirmed(), false);
    return 1;
  };
  await s.footer.children[1].click();
  assert.equal(s.calls.includes("exit"), false);
});

const tagEndpoint =
  "https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/user_card_tags?on_conflict=user_card_id%2Ctag_id&columns=%22user_card_id%22%2C%22tag_id%22";
test("real Supabase endpoint confirms both labels and exits selection after native popup unmounts", async () => {
  const sent = [];
  const { ctx, page } = batchContext(async (url, options) => {
    sent.push(options.body);
    return { status: 201 };
  });
  const s = ui([], async (name) => {
    await page.fetch(tagEndpoint, { method: "POST", body: name });
    s.root.isConnected = false;
    s.rows.forEach((row) => {
      row.isConnected = false;
    });
  });
  s.ctx.WMLabelBatch = ctx.WMLabelBatch;
  s.pick(s.rows[0]);
  s.pick(s.rows[3]);
  assert.equal(sent.length, 0);
  await s.footer.children[1].click();
  assert.deepEqual(sent, ["collection", "vente"]);
  assert.deepEqual(s.calls, ["collection", "vente", "exit"]);
  assert.equal(s.ctx.document.body.children.length, 0);
});

test("Supabase rejection keeps selection and stops before the next label", async () => {
  const { ctx, page } = batchContext(async () => ({ status: 403 }));
  const s = ui([], () => page.fetch(tagEndpoint, { method: "POST" }));
  s.ctx.WMLabelBatch = ctx.WMLabelBatch;
  s.pick(s.rows[0]);
  s.pick(s.rows[3]);
  await s.footer.children[1].click();
  assert.deepEqual(s.calls, ["collection"]);
  assert.match(
    s.ctx.document.body.children[0].children[0].children[0].textContent,
    /403/,
  );
});

test("first batch waits for native refresh after HTTP success before applying the next label", async () => {
  const sent = [];
  let refreshing = false;
  const { ctx, page } = batchContext(async (url, options) => {
    sent.push(options.body);
    return { status: 201 };
  });
  const s = ui([], async (name) => {
    assert.equal(refreshing, false, "native actions must not overlap");
    refreshing = true;
    s.rows.forEach((row) => {
      row.disabled = true;
    });
    await page.fetch(tagEndpoint, { method: "POST", body: name });
    // A cold refresh takes longer than the network observer's quiet period.
    await new Promise((resolve) => setTimeout(resolve, 30));
    refreshing = false;
    s.rows.forEach((row) => {
      row.disabled = false;
    });
  });
  for (const row of s.rows)
    row.click = () => {
      if (row.disabled)
        throw Error("Next label clicked before native refresh finished");
      row.listeners.click(); // DOM click() does not return the handler's promise.
    };
  s.ctx.WMLabelBatch = ctx.WMLabelBatch;
  s.pick(s.rows[0]);
  s.pick(s.rows[3]);
  await s.footer.children[1].click();
  assert.deepEqual(sent, ["collection", "vente"]);
  assert.equal(refreshing, false);
  assert.equal(s.calls.at(-1), "vente");
  assert.equal(s.ctx.document.body.children.length, 0);
});

test("disabling multi-labels restores native controls and re-enabling restores selection", () => {
  const s = ui();
  s.pick(s.rows[0]);
  s.setEnabled(false);
  assert.equal(s.footer.isConnected, false);
  assert.equal(s.rows[0].getAttribute("role"), null);
  assert.equal(s.rows[0].getAttribute("aria-checked"), null);
  assert.equal(s.pick(s.rows[0]), false);
  s.setEnabled(true);
  assert.equal(s.pick(s.rows[0]), true);
});
test("successful application has no progress or success popup", async () => {
  const s = ui();
  s.pick(s.rows[0]);
  s.pick(s.rows[1]);
  s.ctx.WMLabelBatch.apply = async (jobs) => {
    assert.equal(s.footer.hidden, true);
    assert.equal(s.ctx.document.body.children.length, 0);
    for (const job of jobs) await job.run();
    return jobs.length;
  };
  await s.footer.children[1].click();
  assert.equal(s.ctx.document.body.children.length, 0);
});
