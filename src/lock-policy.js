(() => {
  "use strict";
  const key = (card) => JSON.stringify([card.id, card.rarity]);
  function tokens(details) {
    const values = new Set();
    function visit(value) {
      if (typeof value === "string") {
        values.add(value);
        try {
          const parsed = JSON.parse(value);
          if (parsed !== value) visit(parsed);
        } catch {
          /* Plain strings are also valid request values. */
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object")
        Object.values(value).forEach(visit);
    }
    const url = new URL(details.url);
    url.pathname.split("/").forEach((part) => {
      try {
        values.add(decodeURIComponent(part));
      } catch {}
    });
    url.searchParams.forEach(visit);
    if (details.requestBody?.formData) visit(details.requestBody.formData);
    try {
      const decoder = new TextDecoder();
      const text =
        (details.requestBody?.raw ?? [])
          .map((part) =>
            part.bytes ? decoder.decode(part.bytes, { stream: true }) : "",
          )
          .join("") + decoder.decode();
      if (text) {
        try {
          visit(JSON.parse(text));
        } catch {
          new URLSearchParams(text).forEach(visit);
        }
      }
    } catch {}
    return values;
  }
  // Only writes capable of selling or removing owned cards are protected.
  function isRemoval(details) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(details.method))
      return false;
    let pathname;
    try {
      pathname = new URL(details.url).pathname;
    } catch {
      return false;
    }
    if (!pathname.startsWith("/api/")) return false;
    if (
      /\/(?:bids?|buy|purchase|offers?|notifications?|wishlist|labels?|tags?)(?:\/|$)/i.test(
        pathname,
      )
    )
      return false;
    if (
      /\/(?:discard|recycle|burn|destroy|disenchant|sell|sale|auction|auctions)(?:\/|$)/i.test(
        pathname,
      )
    )
      return true;
    if (/^\/api\/marketplace(?:\/|$)/.test(pathname)) return true;
    return (
      details.method === "DELETE" &&
      /^\/api\/(?:collection|inventory)(?:\/|$)/.test(pathname)
    );
  }
  function blocked(details, locks, cards) {
    if (!isRemoval(details)) return false;
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(details.method) ||
      !new URL(details.url).pathname.startsWith("/api/")
    )
      return false;
    const pathname = new URL(details.url).pathname;
    const metadata =
      /\/(?:[a-z-]+-)?(?:labels?|tags?)(?:-[a-z-]+)?(?:\/|$)/.test(pathname);
    if (
      metadata &&
      !/marketplace|auction|sell|sale|discard|recycl|burn|destroy/.test(
        pathname,
      )
    )
      return false;
    const records = Object.values(locks);
    if (!records.length) return false;
    const ids = tokens(details);
    const protectedIds = new Set(
      records.flatMap((record) => [record.id, ...(record.ownedIds ?? [])]),
    );
    for (const card of cards)
      if (locks[key(card)] && card.ownedId) protectedIds.add(card.ownedId);
    if ([...ids].some((id) => protectedIds.has(id))) return true;
    // Do not let a bulk removal with no identifiable targets bypass the locks.
    const removal =
      /marketplace|auction|sell|sale|discard|recycl|burn|destroy|disenchant|collection|inventory/.test(
        new URL(details.url).pathname,
      );
    if (!removal) return false;
    let fromCollection = false;
    try {
      fromCollection = /^\/collection\/?$/.test(
        new URL(details.documentUrl ?? details.originUrl).pathname,
      );
    } catch {}
    if (!fromCollection) return false;
    const knownTarget = cards.some(
      (card) => ids.has(card.id) || (card.ownedId && ids.has(card.ownedId)),
    );
    return !knownTarget;
  }
  globalThis.WMLockPolicy = Object.freeze({ key, isRemoval, blocked });
})();
