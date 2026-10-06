/* Shared pure helpers. No remote code, storage, or credentials. */
(() => {
  "use strict";
  const rarities = new Set(["C", "PC", "R", "SR", "UR", "L"]);
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim();
  const key = (title, rarity) => JSON.stringify([normalize(title), rarity]);
  function collection(payload) {
    if (!Array.isArray(payload?.collection))
      throw new Error("Format de collection inconnu");
    return payload.collection.flatMap((row) => {
      const card = row?.card;
      const rarity = row?.snapshot_rarity ?? card?.rarity;
      if (
        !card ||
        typeof card.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(card.id) ||
        typeof card.wikipedia_title !== "string" ||
        !rarities.has(rarity)
      )
        return [];
      const ownedId = typeof row.id === "string" ? row.id : null;
      return [{ id: card.id, title: card.wikipedia_title, rarity, ownedId }];
    });
  }
  function index(cards) {
    const map = new Map();
    for (const card of cards) {
      const k = key(card.title, card.rarity);
      // Never guess when two distinct cards have the same visible identity.
      if (map.has(k) && map.get(k)?.id !== card.id) map.set(k, null);
      else if (!map.has(k)) map.set(k, card);
    }
    return map;
  }
  globalThis.WMCollection = Object.freeze({
    rarities,
    normalize,
    key,
    collection,
    index,
  });
})();
