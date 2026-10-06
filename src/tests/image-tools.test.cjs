const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
function setup(width = 2400, height = 1600) {
  let decoded = 0,
    closed = 0,
    drawn = 0;
  const canvas = {
    getContext: () => ({
      drawImage() {
        drawn++;
      },
    }),
    toDataURL: (type, quality) => {
      assert.equal(type, "image/webp");
      assert.equal(quality, 0.85);
      return "data:image/webp;base64,COMPRESSED";
    },
  };
  const ctx = {
    document: { createElement: () => canvas },
    createImageBitmap: async () => {
      decoded++;
      return {
        width,
        height,
        close() {
          closed++;
        },
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../image-tools.js"), "utf8"),
    ctx,
  );
  return {
    api: ctx.WMImageTools,
    canvas,
    stats: () => ({ decoded, closed, drawn }),
  };
}
test("image compression caps dimensions, preserves ratio and releases the decoded image", async () => {
  const h = setup();
  assert.equal(
    await h.api.prepare({ type: "image/png", size: 1000 }),
    "data:image/webp;base64,COMPRESSED",
  );
  assert.equal(h.canvas.width, 1200);
  assert.equal(h.canvas.height, 800);
  assert.deepEqual(h.stats(), { decoded: 1, closed: 1, drawn: 1 });
  const small = setup(400, 200);
  await small.api.prepare({ type: "image/jpeg", size: 1000 });
  assert.equal(small.canvas.width, 400);
});
test("oversized files and unsupported types are rejected before decoding", async () => {
  const h = setup();
  await assert.rejects(
    h.api.prepare({ type: "image/png", size: 9 * 1024 * 1024 }),
    /8 Mo/,
  );
  await assert.rejects(
    h.api.prepare({ type: "image/svg+xml", size: 1000 }),
    /PNG/,
  );
  assert.equal(h.stats().decoded, 0);
});
test("huge pixel count and excessive encoded output are rejected without leaking the bitmap", async () => {
  const huge = setup(10000, 10000);
  await assert.rejects(
    huge.api.prepare({ type: "image/png", size: 1000 }),
    /mégapixels/,
  );
  assert.equal(huge.stats().closed, 1);
  assert.equal(huge.stats().drawn, 0);
  const h = setup();
  h.canvas.toDataURL = () => "data:image/webp;base64," + "a".repeat(1400000);
  await assert.rejects(
    h.api.prepare({ type: "image/png", size: 1000 }),
    /lourde/,
  );
  assert.equal(h.stats().closed, 1);
});
