(() => {
  "use strict";
  const page = window.wrappedJSObject;
  if (!page || typeof exportFunction !== "function") return;
  const wrappers = new WeakSet();
  let explicitDestination = null,
    explicitUntil = 0;
  const inCollection = () => /^\/collection\/?$/.test(location.pathname);
  const normalize = (text) =>
    String(text ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  function marketURL(href) {
    if (typeof href !== "string") return null;
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin &&
        /^\/marketplace(?:\/|$)/.test(url.pathname)
        ? url
        : null;
    } catch {
      return null;
    }
  }
  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || !inCollection()) return;
      const target = event.target.closest?.("button, a, [role='button']");
      if (!target || target.closest(".wm-toolbar")) return;
      explicitDestination = null;
      explicitUntil = 0;
      const link = target.closest("a[href]");
      const destination = marketURL(link?.href);
      if (destination) explicitDestination = destination.href;
      else if (
        !link &&
        /marche|marketplace|voir (?:la|ma|cette) vente/.test(
          normalize(target.textContent),
        )
      ) {
        explicitDestination = "market";
      }
      if (explicitDestination) explicitUntil = Date.now() + 1500;
      install();
    },
    true,
  );
  function shouldStay(href) {
    if (globalThis.WMFeatures && !WMFeatures.enabled("market")) return false;
    if (!inCollection()) return false;
    const destination = marketURL(href);
    if (!destination) return false;
    // Automatic post-sale navigation must not depend on a modal's button label,
    // its timing, or whether the destination uses a path or a query parameter.
    return !(
      Date.now() < explicitUntil &&
      (explicitDestination === "market" ||
        explicitDestination === destination.href)
    );
  }
  function install() {
    const router = page.next?.router;
    if (!router) return;
    for (const method of ["push", "replace"]) {
      try {
        const original = router[method];
        if (typeof original !== "function" || wrappers.has(original)) continue;
        const wrapped = exportFunction(function (href, ...args) {
          if (shouldStay(href)) return;
          return original.call(router, href, ...args);
        }, page);
        router[method] = wrapped;
        wrappers.add(router[method]);
      } catch {
        // Retry if Next.js replaces or temporarily locks its router.
      }
    }
  }
  // Also cover navigation outside Next.js on browsers supporting cancellation.
  if (window.navigation)
    window.navigation.addEventListener("navigate", (event) => {
      if (
        event.cancelable &&
        !event.hashChange &&
        event.navigationType !== "traverse" &&
        shouldStay(event.destination.url)
      ) {
        event.preventDefault();
      }
    });
  install();
  WMPageEvents.subscribe(install);
})();
