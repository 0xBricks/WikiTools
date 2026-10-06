(() => {
  "use strict";
  const normalize = (text) =>
    String(text ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const labels = (button) =>
    [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.textContent,
    ]
      .filter(Boolean)
      .map(normalize);
  function visible(element) {
    if (
      !element.isConnected ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    )
      return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      element.getClientRects().length > 0
    );
  }
  function available(button) {
    return (
      visible(button) &&
      !button.disabled &&
      !button.matches(":disabled") &&
      button.getAttribute("aria-disabled") !== "true" &&
      button.getAttribute("aria-busy") !== "true" &&
      !button.closest("nav, header, footer, .wm-toolbar")
    );
  }
  function direction(button, side) {
    // A chevron decorating Open/Continue is not a carousel navigation button.
    if (action(button, "open") || action(button, "continue")) return false;
    const words =
      side === "left"
        ? /^(precedent|precedente|gauche|previous|prev|left|[←‹«❮])(?:\b|$|\s)/
        : /^(suivant|suivante|droite|next|right|[→›»❯])(?:\b|$|\s)/;
    if (
      labels(button).some((label) => words.test(label)) ||
      button.querySelector(
        `.lucide-chevron-${side}, .lucide-arrow-${side}, .lucide-circle-chevron-${side}, .lucide-circle-arrow-${side}`,
      )
    )
      return true;
    // Some of the site's arrow buttons use a plain SVG, without an icon class.
    const shapes =
      side === "left"
        ? [
            "m1518-6-66-6",
            "m1518l-6-66-6",
            "m156-6666",
            "m156l-6666",
            "1518912156",
            "1569121518",
          ]
        : [
            "m9186-6-6-6",
            "m918l6-6-6-6",
            "m9666-66",
            "m96l66-66",
            "918151296",
            "961512918",
          ];
    return [
      ...(button.querySelectorAll?.("svg path, svg polyline") ?? []),
    ].some((shape) => {
      const value = (
        shape.getAttribute("d") ??
        shape.getAttribute("points") ??
        ""
      )
        .toLowerCase()
        .replace(/[\s,]/g, "");
      return shapes.includes(value);
    });
  }
  function action(button, name) {
    return labels(button).some((label) =>
      name === "continue"
        ? /^continuer(?:\b|\s|$)/.test(label)
        : /^ouvrir(?:\b|\s|$)/.test(label),
    );
  }
  function unique(buttons, predicate) {
    const matches = buttons.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (globalThis.WMFeatures && !WMFeatures.enabled("pullsKeyboard")) return;
      if (
        !/^\/pulls\/?$/.test(location.pathname) ||
        !event.isTrusted ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        !["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)
      )
        return;
      const target = event.target;
      if (
        target?.isContentEditable ||
        target?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="combobox"]',
        )
      )
        return;
      // A held key must never open a succession of packs or skip their reveal.
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      const dialogs = [
        ...document.querySelectorAll('[role="dialog"], dialog[open]'),
      ].filter(visible);
      const scope = dialogs.length
        ? dialogs[dialogs.length - 1]
        : event.key === "Enter"
          ? (document.querySelector("main") ?? document)
          : document;
      const buttons = [
        ...scope.querySelectorAll('button, [role="button"]'),
      ].filter(available);
      let button;
      if (event.key === "Enter") {
        const focused = target?.closest?.(
          'button, [role="button"], a[href], summary',
        );
        const focusedArrow =
          focused &&
          (direction(focused, "left") || direction(focused, "right"));
        // Enter must never fall through to the browser's native click on a
        // focused arrow, even when no Continue/Open button is currently shown.
        if (focusedArrow) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        const focusedAction =
          focused && (action(focused, "continue") || action(focused, "open"));
        if (focused && !focusedArrow && !focusedAction) return;
        if (focusedAction && buttons.includes(focused)) {
          button = focused;
        } else {
          const next = buttons.filter((candidate) =>
            action(candidate, "continue"),
          );
          button = next.length
            ? next.length === 1
              ? next[0]
              : null
            : unique(buttons, (candidate) => action(candidate, "open"));
        }
      } else
        button = unique(buttons, (candidate) =>
          direction(candidate, event.key === "ArrowLeft" ? "left" : "right"),
        );
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Reuse the site's normal handlers, validation and loading state. No API calls.
      button.click();
    },
    true,
  );
})();
