(() => {
  "use strict";
  let locks = {},
    ready = false,
    saving = false,
    menu,
    lock,
    notice,
    scheduled = false;
  const wrappers = new Map();
  const disabledActions = new Map();
  const enlargedMarkers = new Map();
  let openedCard = null;
  let deselectSource = null,
    deselectControl = null;
  const pageDeselectButtons = new Set();
  const enabled = () => !globalThis.WMFeatures || WMFeatures.enabled("locks");
  globalThis.WMFeatures?.subscribe(schedule);
  const key = (card) => JSON.stringify([card.id, card.rarity]);
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/’/g, "'")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
  const text = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  function report(message) {
    if (notice) text(notice, message);
  }
  function receive(message) {
    if (message?.type === "wm-locks") {
      locks = message.locks ?? {};
      ready = true;
      schedule();
    }
    if (message?.type === "wm-lock-blocked")
      report(
        "Action bloquée : déverrouillez les cartes concernées avant de vendre ou défausser.",
      );
  }
  browser.runtime.onMessage.addListener(receive);
  browser.runtime
    .sendMessage({ type: "wm-locks-ready" })
    .then(receive)
    .catch(() => report("Verrous indisponibles. Rechargez l’extension."));
  function currentFiber(fiber) {
    if (!fiber?.alternate) return fiber;
    let root = fiber;
    while (root.return) root = root.return;
    const current = root.stateNode?.current;
    // React keeps the DOM pointer on either buffer after a commit. Reading that
    // buffer blindly returns the previous selection on every other render.
    if (current === root) return fiber;
    if (current === root.alternate) return fiber.alternate;
    return fiber;
  }
  function nativeSelected(wrapper) {
    // The collection renders its selection checkbox as a direct-child span,
    // outside the card face. Its lucide-check SVG is present only when selected.
    // Prefer this visible state to React internals, including when unchecked.
    const indicator = [...wrapper.children].find(
      (child) =>
        child.matches(
          'span.pointer-events-none.absolute[aria-hidden="true"]',
        ) && child.classList.contains("border-2"),
    );
    if (indicator) return Boolean(indicator.querySelector("svg.lucide-check"));
    if (wrapper.matches('[aria-selected="true"], [data-selected="true"]'))
      return true;
    const checkbox = wrapper.querySelector(
      'input[type="checkbox"], [role="checkbox"]',
    );
    if (checkbox)
      return (
        checkbox.checked === true ||
        checkbox.getAttribute("aria-checked") === "true" ||
        checkbox.getAttribute("data-state") === "checked"
      );
    if (wrapper.querySelector('[aria-selected="true"], [data-selected="true"]'))
      return true;
    // Read the site's selection flag when its custom React card has no checkbox.
    // Never maintain another selection or change the site's React state.
    const nodes = [wrapper, wrapper.querySelector("h3")];
    for (const node of nodes) {
      const raw = node?.wrappedJSObject ?? node;
      if (!raw) continue;
      try {
        const fiberKey = Object.keys(raw).find((name) =>
          name.startsWith("__reactFiber$"),
        );
        let fiber = currentFiber(raw[fiberKey]);
        for (
          let depth = 0;
          fiber && depth < 50;
          depth++, fiber = fiber.return
        ) {
          const props = fiber.memoizedProps;
          if (typeof props?.isSelected === "boolean") return props.isSelected;
          if (typeof props?.selected === "boolean") return props.selected;
          const card = wrappers.get(wrapper)?.card;
          for (const name of [
            "selectedIds",
            "selectedCardIds",
            "selectedCards",
          ]) {
            const selection = props?.[name];
            if (!selection || !card) continue;
            if (typeof selection.has === "function")
              return selection.has(card.ownedId) || selection.has(card.id);
            if (Array.isArray(selection))
              return selection.some(
                (value) => value === card.id || value === card.ownedId,
              );
          }
        }
      } catch {
        /* React internals are optional; unknown selection is never guessed. */
      }
    }
    return false;
  }
  function selectedKeys() {
    return [
      ...new Set(
        [...wrappers]
          .filter(([wrapper]) => wrapper.isConnected && nativeSelected(wrapper))
          .map(([, entry]) => key(entry.card)),
      ),
    ];
  }
  function selectionAnchor() {
    syncPageDeselect();
    const buttons = [...document.querySelectorAll("button")].filter(
      (button) =>
        !button.closest(
          '.wm-toolbar, .wm-native-lock-actions, div.relative.isolate.group, [role="dialog"], dialog',
        ) && !isCardPopupAction(button),
    );
    const bottomButtons = buttons.filter((button) => {
      if (button === deselectControl) return false;
      for (
        let parent = button.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          (style.position === "fixed" || style.position === "sticky") &&
          style.bottom !== "auto"
        )
          return true;
      }
      return false;
    });
    syncDeselect(
      bottomButtons.find((button) =>
        /^(annuler la selection|quitter la selection|terminer la selection)$/.test(
          normalize(button.textContent),
        ),
      ),
    );
    // Removal buttons also appear in custom confirmation overlays without a
    // dialog role. Only selection controls may anchor the lock button.
    const labelAction = (button) =>
      /^(?:(?:appliquer|ajouter|modifier|gerer|retirer)\s+(?:(?:une|des|les)\s+|l')?)?etiquettes?(?:\s*\(\d+\))?$/.test(
        normalize(button.textContent),
      );
    const deselectAction = (button) =>
      /^(?:tout deselectionner|deselectionner)(?:\s*\(\d+\))?$/.test(
        normalize(button.textContent),
      );
    const selectAction = (button) =>
      /^tout selectionner(?: (?:sur )?(?:la|cette) page)?(?:\s*\(\d+\))?$/.test(
        normalize(button.textContent),
      );
    const anchor =
      bottomButtons.find(labelAction) ??
      deselectSource ??
      bottomButtons.find(deselectAction) ??
      bottomButtons.find(selectAction);
    // Some collection views keep the native controls in the page flow rather
    // than a fixed bottom bar. Require an actual selection for that fallback.
    return (
      anchor ??
      (selectedKeys().length
        ? buttons.find(
            (button) =>
              button !== deselectControl &&
              (deselectAction(button) || selectAction(button)),
          )
        : null)
    );
  }
  function syncPageDeselect(clear = false) {
    const redundant = new Set(
      clear
        ? []
        : [...document.querySelectorAll("button")].filter((button) =>
            /^(tout )?deselectionner (la|cette) page$/.test(
              normalize(button.textContent),
            ),
          ),
    );
    for (const button of pageDeselectButtons) {
      if (!redundant.has(button)) {
        button.classList.remove("wm-page-deselect-hidden");
        pageDeselectButtons.delete(button);
      }
    }
    for (const button of redundant) {
      if (!pageDeselectButtons.has(button)) {
        button.classList.add("wm-page-deselect-hidden");
        pageDeselectButtons.add(button);
      }
    }
  }
  function syncDeselect(source) {
    if (source !== deselectSource) {
      deselectSource?.classList.remove("wm-deselect-source");
      deselectControl?.remove();
      deselectControl = null;
      deselectSource = source ?? null;
    }
    if (!source) return;
    if (!deselectControl) {
      deselectControl = document.createElement("button");
      deselectControl.type = "button";
      deselectControl.className = `${source.className} wm-deselect-control`;
      deselectControl.addEventListener("click", () => deselectSource?.click());
      document.body.append(deselectControl);
      source.classList.add("wm-deselect-source");
    }
    text(deselectControl, source.textContent);
    if (deselectControl.disabled !== source.disabled)
      deselectControl.disabled = source.disabled;
  }
  function isRemovalAction(button) {
    // A label named "vente" is metadata, not a sale action.
    if (
      button.closest(".wm-label-footer, .wm-label-option") ||
      (button.closest("div.max-h-64.overflow-y-auto") &&
        button.querySelector("span.rounded-full"))
    )
      return false;
    const label = normalize(
      [
        button.textContent,
        button.getAttribute?.("aria-label"),
        button.getAttribute?.("title"),
        button.value,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return /\b(vendre|vente|encheres|defausser|defausse)\b/.test(label);
  }
  function isCardPopupAction(button) {
    // The site's custom popup is not necessarily an ARIA dialog. These are
    // its actual auction/discard controls, supplied from the collection HTML.
    return (
      button.classList.contains("flex-1") &&
      Boolean(
        button.querySelector(
          "svg.lucide-gavel, svg.lucide-trash2, svg.lucide-trash-2",
        ),
      )
    );
  }
  function concernsLockedCard(button) {
    if (!enabled()) return false;
    const wrapper = button.closest("div.relative.isolate.group");
    if (wrappers.has(wrapper))
      return Boolean(locks[key(wrappers.get(wrapper).card)]);
    // A card detail dialog concerns the card opened, not the bulk selection.
    if (
      (button.closest('[role="dialog"], dialog') ||
        isCardPopupAction(button)) &&
      openedCard
    )
      return Boolean(locks[openedCard]);
    const selected = selectedKeys();
    if (selected.length) return selected.some((id) => locks[id]);
    return Boolean(openedCard && locks[openedCard]);
  }
  function restoreAction(button, original) {
    if ("disabled" in button) button.disabled = original.disabled;
    if (original.aria === null) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", original.aria);
    if (original.title === null) button.removeAttribute("title");
    else button.setAttribute("title", original.title);
    button.classList.remove("wm-locked-action");
    disabledActions.delete(button);
  }
  function syncActions() {
    const blocked = new Set();
    for (const button of document.querySelectorAll(
      'button, [role="button"], [role="menuitem"], input[type="submit"]',
    )) {
      if (button.closest(".wm-native-lock-actions, .wm-toolbar")) continue;
      if (!isRemovalAction(button) || !concernsLockedCard(button)) continue;
      blocked.add(button);
      if (!disabledActions.has(button))
        disabledActions.set(button, {
          disabled: button.disabled,
          aria: button.getAttribute("aria-disabled"),
          title: button.getAttribute("title"),
        });
      if ("disabled" in button && !button.disabled) button.disabled = true;
      if (button.getAttribute("aria-disabled") !== "true")
        button.setAttribute("aria-disabled", "true");
      const hint =
        "Carte verrouillée : déverrouillez-la avant de vendre ou défausser.";
      if (button.title !== hint) button.title = hint;
      if (!button.classList.contains("wm-locked-action"))
        button.classList.add("wm-locked-action");
    }
    for (const [button, original] of disabledActions) {
      if (!button.isConnected) disabledActions.delete(button);
      else if (!blocked.has(button)) restoreAction(button, original);
    }
  }
  function sync() {
    scheduled = false;
    if (!/^\/collection\/?$/.test(location.pathname)) {
      leave();
      return;
    }
    const anchor = enabled() ? selectionAnchor() : null;
    if (!enabled()) {
      syncDeselect(null);
      syncPageDeselect(true);
    }
    if (!anchor) {
      menu?.remove();
      menu = null;
    } else if (!menu?.isConnected || menu.previousElementSibling !== anchor) {
      menu?.remove();
      menu = document.createElement("span");
      menu.className = "wm-native-lock-actions";
      function button(label, action) {
        const result = document.createElement("button");
        result.type = "button";
        result.textContent = label;
        result.className = anchor.className.replace(
          /\bwm-deselect-source\b/g,
          "",
        );
        result.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          action();
        });
        return result;
      }
      lock = button("Verrouiller", () => {
        const selected = selectedKeys();
        save(!selected.length || !selected.every((id) => locks[id]));
      });
      notice = document.createElement("span");
      notice.className = "wm-lock-notice";
      notice.setAttribute("role", "status");
      menu.append(lock, notice);
      anchor.insertAdjacentElement("afterend", menu);
    }
    for (const [wrapper, entry] of wrappers) {
      if (!wrapper.isConnected) {
        wrappers.delete(wrapper);
        continue;
      }
      const locked = enabled() && Boolean(locks[key(entry.card)]);
      if (wrapper.classList.contains("wm-card-locked") !== locked)
        wrapper.classList.toggle("wm-card-locked", locked);
      entry.marker.hidden = !locked;
    }
    syncEnlargedMarkers();
    syncActions();
    if (!menu) return;
    const selected = selectedKeys();
    lock.disabled = !ready || saving || !selected.length;
    const allLocked = selected.length > 0 && selected.every((id) => locks[id]);
    text(
      lock,
      `${allLocked ? "Déverrouiller" : "Verrouiller"} (${selected.length})`,
    );
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      setTimeout(sync, 0);
    }
  }
  async function save(locked) {
    const selected = selectedKeys();
    if (!enabled() || !ready || saving || !selected.length) return;
    saving = true;
    sync();
    try {
      const response = await browser.runtime.sendMessage({
        type: "wm-set-locks",
        keys: selected,
        locked,
      });
      if (response?.type !== "wm-locks") throw new Error("No acknowledgement");
      receive(response);
      report("");
    } catch {
      report("Enregistrement impossible. Les verrous n’ont pas été modifiés.");
    } finally {
      saving = false;
      sync();
    }
  }
  function card(wrapper, card) {
    let entry = wrappers.get(wrapper);
    if (!entry || !entry.marker.isConnected) {
      const marker = createMarker();
      const rarity = wrapper.querySelector("div.absolute.top-2.left-2");
      (rarity ?? wrapper).append(marker);
      entry = { marker, card };
      wrappers.set(wrapper, entry);
    }
    entry.card = card;
    schedule();
  }
  function createMarker() {
    const marker = document.createElement("span");
    marker.className = "wm-lock-marker";
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", "Carte verrouillée");
    marker.title = "Carte verrouillée";
    marker.hidden = true;
    return marker;
  }
  function syncEnlargedMarkers() {
    const visible = new Set();
    for (const rarity of document.querySelectorAll(
      "div.absolute.top-2.left-2",
    )) {
      const value = rarity.textContent.trim();
      if (!["C", "PC", "R", "SR", "UR", "L"].includes(value)) continue;
      const wrapper = rarity.closest("div.relative.isolate.group");
      if (wrappers.has(wrapper)) continue;
      const title = rarity.parentElement?.querySelector("h3")?.textContent;
      const matches = [...wrappers.values()].filter(
        (entry) =>
          entry.card.rarity === value &&
          title &&
          normalize(entry.card.title) === normalize(title),
      );
      const identities = new Set(matches.map((entry) => key(entry.card)));
      const identity = identities.size === 1 ? [...identities][0] : null;
      // Match the enlarged card itself, so a popup never inherits a stale lock.
      if (!identity) continue;
      visible.add(rarity);
      let marker = enlargedMarkers.get(rarity);
      if (!marker?.isConnected) {
        marker = createMarker();
        rarity.append(marker);
        enlargedMarkers.set(rarity, marker);
      }
      marker.hidden = !enabled() || !locks[identity];
    }
    for (const [rarity, marker] of enlargedMarkers)
      if (!rarity.isConnected || !visible.has(rarity)) {
        marker.remove();
        enlargedMarkers.delete(rarity);
      }
  }
  function remove(wrapper) {
    wrappers.get(wrapper)?.marker.remove();
    wrappers.delete(wrapper);
    wrapper.classList.remove("wm-card-locked");
  }
  function leave() {
    syncPageDeselect(true);
    syncDeselect(null);
    for (const marker of enlargedMarkers.values()) marker.remove();
    enlargedMarkers.clear();
    for (const [button, original] of disabledActions)
      restoreAction(button, original);
    openedCard = null;
    for (const wrapper of wrappers.keys()) remove(wrapper);
    menu?.remove();
    menu = null;
  }
  // Stop the action before React handles it, also during the brief interval
  // between a lock update and the next DOM repaint.
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.(
        'button, [role="button"], [role="menuitem"], input[type="submit"]',
      );
      if (
        button &&
        !button.closest(".wm-native-lock-actions, .wm-toolbar") &&
        isRemovalAction(button) &&
        concernsLockedCard(button)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        syncActions();
        return;
      }
      const wrapper = event.target.closest?.("div.relative.isolate.group");
      // Remember the clicked card even when selection controls remain in the DOM.
      // Their presence alone does not mean that a click cannot open a popup.
      if (wrappers.has(wrapper)) openedCard = key(wrappers.get(wrapper).card);
      else if (
        button &&
        !button.closest('[role="dialog"], dialog') &&
        !isCardPopupAction(button) &&
        !wrapper
      )
        openedCard = null;
      schedule();
    },
    true,
  );
  // Observe the selection that the site has already applied, including Select all.
  document.addEventListener("click", schedule);
  document.addEventListener("change", schedule);
  new MutationObserver((records) => {
    if (!/^\/collection\/?$/.test(location.pathname) && !wrappers.size && !menu)
      return;
    if (
      records.some(
        (record) =>
          !record.target.closest?.(".wm-native-lock-actions, .wm-lock-marker"),
      )
    )
      schedule();
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "class",
      "disabled",
      "aria-selected",
      "aria-checked",
      "data-selected",
      "data-state",
      "checked",
    ],
    characterData: true,
  });
  globalThis.WMLocks = Object.freeze({ card, remove, leave });
})();
