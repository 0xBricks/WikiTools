(() => {
  "use strict";
  const defaults = {
    effect: "native",
    intensity: 35,
    focus: 30,
    focusX: 50,
    tilt: false,
    cards: {},
  };
  let settings = { ...defaults },
    panel,
    count,
    timer;
  const tracked = new Map();
  let framingSave;
  let saveQueue = Promise.resolve();
  const enabled = () => !globalThis.WMFeatures || WMFeatures.enabled("fullArt");
  let selectedCard = "",
    selectedLabel = "",
    picking = false,
    imageImport = 0;
  const pickTargets = new Set();
  const selection = new Map();
  const hiddenLabels = new Set();
  let multipleSelection = false;
  function selectionChanged() {
    selectedCard = selection.size === 1 ? selection.keys().next().value : "";
    selectedLabel = selection.size === 1 ? selection.values().next().value : "";
    scan();
  }
  function updateSelection(patch) {
    for (const key of selection.keys())
      settings.cards[key] = { ...appearance(key), ...patch };
    if (selection.size) {
      void save();
      scan();
    }
  }
  function setPicking(value) {
    picking = value && enabled();
    for (const card of pickTargets)
      card.classList.remove("wmfa-pickable", "wmfa-picked");
    pickTargets.clear();
    if (picking)
      for (const card of candidatesOnPage()) {
        card.classList.add("wmfa-pickable");
        card.classList.toggle("wmfa-picked", selection.has(cardKey(card)));
        pickTargets.add(card);
      }
    if (panel) {
      const button = panel.querySelector('[data-action="pick-card"]');
      button.textContent = picking
        ? multipleSelection
          ? "Terminer la sélection"
          : "Annuler la sélection"
        : selection.size
          ? "Changer la sélection"
          : "Personnaliser une carte";
      button.setAttribute("aria-pressed", String(picking));
      panel.querySelector("[data-pick-hint]").textContent = picking
        ? multipleSelection
          ? "Clique sur les cartes à ajouter ou retirer, puis termine la sélection. Échap pour terminer."
          : "Clique sur une carte dans la page. Échap pour annuler."
        : "Choisis directement une carte dans la collection ou la vitrine.";
    }
  }
  function chooseCard(event) {
    if (
      !picking ||
      event.target.closest?.(".wm-toolbar") ||
      (event.button != null && event.button !== 0)
    )
      return;
    const card = candidatesOnPage().find((card) => card.contains(event.target));
    if (!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = cardKey(card);
    if (!multipleSelection) selection.clear();
    if (multipleSelection && selection.has(key)) selection.delete(key);
    else selection.set(key, card.querySelector("h3").textContent.trim());
    if (!multipleSelection) setPicking(false);
    selectionChanged();
    const tools = panel?.closest(".wm-tools");
    if (tools) tools.open = true;
    if (!multipleSelection) panel?.querySelector('[name="cardFull"]').focus();
  }
  document.addEventListener("click", chooseCard, true);
  document.addEventListener(
    "keydown",
    (event) => {
      if (picking && event.key === "Escape") {
        event.preventDefault();
        setPicking(false);
        panel?.querySelector('[data-action="pick-card"]').focus();
      }
    },
    true,
  );
  addEventListener("popstate", () => setPicking(false));
  addEventListener("pagehide", () => setPicking(false));
  const rarities = new Set(["C", "PC", "R", "SR", "UR", "L"]);
  function candidatesOnPage() {
    return [
      ...new Set(
        [...document.querySelectorAll("h3")]
          .map((h) => h.parentElement?.parentElement)
          .filter(
            (card) =>
              card &&
              [...card.querySelectorAll("div.absolute.top-2.left-2")].some(
                (r) => rarities.has(r.textContent.trim()),
              ),
          ),
      ),
    ];
  }
  const cardKey = (card) =>
    normalize(card.querySelector("h3")?.textContent ?? "");
  const appearance = (key) =>
    Object.hasOwn(settings.cards, key) ? settings.cards[key] : {};
  const customized = (key) => {
    const value = appearance(key);
    return (
      value.full === true ||
      Boolean(value.customImage) ||
      ["focus", "focusX", "zoom"].some((name) => Number.isFinite(value[name]))
    );
  };
  const framing = (key) => {
    const card = appearance(key);
    return {
      focus: card.focus ?? settings.focus,
      focusX: card.focusX ?? settings.focusX,
      zoom: card.zoom ?? 100,
    };
  };
  function updateCard(key, patch) {
    settings.cards[key] = { ...appearance(key), ...patch };
    if (
      Object.keys(patch).every((name) =>
        ["focus", "focusX", "zoom"].includes(name),
      )
    ) {
      // Preview immediately without rewriting the image in storage on every tick.
      for (const card of candidatesOnPage())
        if (cardKey(card) === key) decorate(card);
      for (const [name, value] of Object.entries(framing(key))) {
        const input = panel?.querySelector(`[name="${name}"]`);
        if (input) input.value = String(value);
        const output = panel?.querySelector(`[data-value="${name}"]`);
        if (output) output.textContent = `${value} %`;
      }
      clearTimeout(framingSave);
      framingSave = setTimeout(() => void save(), 250);
    } else {
      void save();
      scan();
    }
  }
  function colorHex(rgb) {
    return (
      "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")
    );
  }
  function automaticHalo(card) {
    const styles = [card, ...card.children]
      .filter(
        (el) =>
          !el.classList.contains("wmfa-fa") &&
          !el.classList.contains("wmfa-frame"),
      )
      .map((el) => getComputedStyle(el));
    const colors = (text) =>
      (text.match(/rgba?\([^)]+\)/g) || [])
        .map((value) => {
          const parts = value.match(/[\d.]+/g).map(Number);
          return (parts[3] ?? 1) >= 0.15 ? parts.slice(0, 3) : null;
        })
        .filter(Boolean);
    // A neutral dark outline must not hide the actual colored frame or background.
    const borders = styles.flatMap((style) =>
      ["Top", "Right", "Bottom", "Left"].flatMap((side) =>
        parseFloat(style["border" + side + "Width"]) > 0 &&
        !["none", "hidden"].includes(style["border" + side + "Style"])
          ? colors(style["border" + side + "Color"])
          : [],
      ),
    );
    const backgrounds = styles.flatMap((style) =>
      colors(
        (style.backgroundImage || "") + " " + (style.backgroundColor || ""),
      ),
    );
    const vivid = (rgb) =>
      Math.max(...rgb) - Math.min(...rgb) > 30 && Math.max(...rgb) > 90;
    const rgb = borders.find(vivid) || backgrounds.find(vivid);
    return rgb ? colorHex(rgb) : "#e53935";
  }
  function imageHalo(image) {
    if (!image.complete || !image.naturalWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 32, 32);
      const data = context.getImageData(0, 0, 32, 32).data;
      const buckets = new Map();
      let dark = 0,
        total = 0;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          if (x >= 5 && x < 27 && y >= 5 && y < 27) continue;
          const i = (y * 32 + x) * 4;
          if (data[i + 3] < 128) continue;
          const rgb = [data[i], data[i + 1], data[i + 2]];
          total++;
          if (Math.max(...rgb) < 85) {
            dark++;
            continue;
          }
          const key = rgb.map((n) => Math.floor(n / 32)).join(",");
          const bucket = buckets.get(key) || { count: 0, sum: [0, 0, 0] };
          bucket.count++;
          rgb.forEach((n, j) => (bucket.sum[j] += n));
          buckets.set(key, bucket);
        }
      if (!total) return null;
      if (dark / total > 0.6) return "#e53935";
      const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
      return best ? colorHex(best.sum.map((n) => n / best.count)) : "#e53935";
    } catch {
      return null;
    } // Remote images can prohibit pixel access; retain the native palette.
  }
  function syncCards(candidates) {
    if (!panel) return;
    panel.querySelector('[name="multipleSelection"]').checked =
      multipleSelection;
    panel.querySelector("[data-selected-card]").textContent =
      selection.size > 1
        ? `${selection.size} cartes sélectionnées : ${[...selection.values()].join(", ")}`
        : selectedLabel || "Aucune carte sélectionnée";
    panel.querySelector("[data-card-editor]").hidden = !selection.size;
    panel.querySelector('[data-action="clear-selection"]').disabled =
      !selection.size;
    panel.querySelector("[data-group-hint]").hidden = selection.size < 2;
    setPicking(picking);
    const preview = panel.querySelector("[data-photo-preview]");
    const photo = appearance(selectedCard).customImage;
    preview.hidden = !photo;
    if (photo && preview.getAttribute("src") !== photo) preview.src = photo;
    if (!photo) preview.removeAttribute("src");
    panel.querySelector("[data-photo-caption]").textContent = !selectedCard
      ? "Sélectionne une carte pour ajouter une image."
      : photo
        ? "Image personnalisée enregistrée pour cette carte."
        : "Aucune image personnalisée pour cette carte.";
    panel.querySelector('[data-action="choose-photo"]').disabled =
      !selectedCard;
    panel.querySelector('[name="cardFull"]').checked =
      appearance(selectedCard).full === true;
    panel.querySelector('[name="cardFull"]').disabled = !selectedCard;
    panel.querySelector('[name="haloEnabled"]').checked =
      appearance(selectedCard).haloEnabled !== false;
    for (const [name, value] of Object.entries(framing(selectedCard))) {
      panel.querySelector(`[name="${name}"]`).value = String(value);
      panel.querySelector(`[data-value="${name}"]`).textContent = `${value} %`;
    }
    const selected = candidates.find((card) => cardKey(card) === selectedCard);
    panel.querySelector('[name="haloColor"]').value =
      appearance(selectedCard).haloColor ||
      tracked.get(selected)?.autoHalo ||
      (selected ? automaticHalo(selected) : "#e53935");
    for (const el of panel.querySelectorAll(
      '[name="haloColor"],[name="photo"],[data-action="reset-photo"],[data-action="reset-halo"]',
    ))
      el.disabled = !selectedCard;
    for (const el of panel.querySelectorAll(
      '[name="haloColor"],[data-action="reset-halo"]',
    ))
      el.disabled =
        !selectedCard || appearance(selectedCard).haloEnabled === false;
    for (const [name, property, fallback] of [
      ["cardFull", "full", false],
      ["haloEnabled", "haloEnabled", true],
      ["showBadge", "showBadge", true],
      ["hideLabels", "hideLabels", false],
    ]) {
      const input = panel.querySelector(`[name="${name}"]`);
      const values = [...selection.keys()].map(
        (key) => appearance(key)[property] ?? fallback,
      );
      input.checked = values.length > 0 && values.every(Boolean);
      input.indeterminate = values.some(Boolean) && !values.every(Boolean);
      input.disabled = !selection.size;
    }
    const haloAvailable = [...selection.keys()].some(
      (key) =>
        appearance(key).full === true && appearance(key).haloEnabled !== false,
    );
    panel.querySelector("[data-halo-options]").hidden = !haloAvailable;
    if (!haloAvailable) panel.querySelector("[data-halo-options]").open = false;
    panel.querySelector("[data-image-section]").hidden = selection.size !== 1;
    for (const el of panel.querySelectorAll(
      '[name="haloColor"],[data-action="reset-halo"]',
    ))
      el.disabled = !selection.size || !haloAvailable;
    for (const el of panel.querySelectorAll(
      '[name="focus"],[name="focusX"],[name="zoom"],[data-action="reset-framing"]',
    ))
      el.disabled = !selectedCard;
    panel.querySelector('[name="photo"]').disabled = !selectedCard;
    panel.querySelector("[data-full-art-options]").hidden = ![
      ...selection.keys(),
    ].some((key) => appearance(key).full === true);
    if (selection.size > 1)
      panel.querySelector("[data-photo-caption]").textContent =
        "Sélectionne une seule carte pour modifier sa photo et son cadrage.";
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const normalize = (s) => s.normalize("NFC").trim().toLocaleLowerCase("fr");
  function sanitize(raw = {}) {
    const next = { ...defaults };
    for (const k of ["tilt"]) if (typeof raw[k] === "boolean") next[k] = raw[k];
    if (["native", "prism", "gold", "stars"].includes(raw.effect))
      next.effect = raw.effect;
    for (const k of ["intensity", "focus", "focusX"])
      if (Number.isFinite(raw[k])) next[k] = Math.min(100, Math.max(0, raw[k]));

    next.cards = {};
    if (raw.cards && typeof raw.cards === "object")
      for (const [key, value] of Object.entries(raw.cards)) {
        if (
          !value ||
          typeof value !== "object" ||
          ["__proto__", "constructor", "prototype"].includes(key)
        )
          continue;
        next.cards[key] = {
          haloEnabled: value.haloEnabled !== false,
          full: value.full === true,
          showBadge: value.showBadge !== false,
          hideLabels: value.hideLabels === true,
          customImage:
            typeof value.customImage === "string" &&
            value.customImage.startsWith("data:image/")
              ? value.customImage
              : null,
          haloColor: /^#[0-9a-f]{6}$/i.test(value.haloColor || "")
            ? value.haloColor
            : null,
        };
        for (const name of ["focus", "focusX", "zoom"])
          if (Number.isFinite(value[name]))
            next.cards[key][name] = Math.min(
              name === "zoom" ? 250 : 100,
              Math.max(name === "zoom" ? 100 : 0, value[name]),
            );
      }
    return next;
  }
  const supported = () =>
    /^\/(collection|global-collection)\/?$/.test(location.pathname) ||
    candidatesOnPage().length > 0;
  function restore(card) {
    const state = tracked.get(card);
    if (!state) return;
    card.removeEventListener("pointermove", state.move);
    card.removeEventListener("pointerleave", state.leave);
    state.image.removeEventListener("load", state.imageLoad);
    state.nativeImage?.removeEventListener("load", state.nativeLoad);
    state.image.remove();
    state.portrait.classList.remove("wmfa-has-image");
    state.overlay.remove();
    state.badge.remove();
    state.frame.remove();
    state.resize?.disconnect();
    if (state.createdPortrait) state.portrait.remove();
    for (const [el, cls] of state.classes) el.classList.remove(cls);
    card.removeAttribute("data-wmfa-effect");
    for (const prop of [
      "--wmfa-x",
      "--wmfa-y",
      "--wmfa-angle",
      "--wmfa-intensity",
      "--wmfa-focus",
      "--wmfa-focus-x",
      "--wmfa-halo",
      "--wmfa-zoom",
    ])
      card.style.removeProperty(prop);
    card.classList.remove(
      "wmfa-full",
      "wmfa-tilt",
      "wmfa-custom-halo",
      "wmfa-no-halo",
    );
    tracked.delete(card);
  }
  function decorate(card) {
    let state = tracked.get(card);
    if (
      state &&
      (!card.contains(state.portrait) ||
        !state.portrait.contains(state.image) ||
        state.nativeImage !==
          state.portrait.querySelector("img:not(.wmfa-image)"))
    ) {
      restore(card);
      state = null;
    }
    if (!state) {
      const heading = card.querySelector("h3");
      const content = heading?.parentElement;
      let portrait = [...card.children].find(
        (e) => e !== content && e.tagName === "DIV" && e.querySelector("img"),
      );
      if (!heading || !content || content.parentElement !== card) return;
      // Prefer the placeholder just before the text, not a decorative backdrop.
      portrait ||= [...card.children]
        .reverse()
        .find(
          (el) =>
            el !== content &&
            el.tagName === "DIV" &&
            !el.matches(".absolute.top-2.left-2") &&
            !el.className.includes("wmfa-") &&
            el.compareDocumentPosition(content) &
              Node.DOCUMENT_POSITION_FOLLOWING,
        );
      const createdPortrait = !portrait;
      if (!portrait) {
        portrait = document.createElement("div");
        portrait.className = "wmfa-empty-portrait";
        card.insertBefore(portrait, content);
      }
      const nativeImage = portrait.querySelector("img");
      // Keep React's image and responsive sources untouched; render our own layer.
      const image = document.createElement("img");
      image.className = "wmfa-image";
      image.alt = nativeImage?.alt || heading.textContent.trim();
      image.draggable = false;
      portrait.append(image);
      const autoHalo = automaticHalo(card);
      const classes = [
        [card, "wmfa-card"],
        [portrait, "wmfa-portrait"],
        [content, "wmfa-content"],
      ];
      if (getComputedStyle(portrait).position === "static")
        classes.push([portrait, "wmfa-positioned"]);
      for (const [el, cls] of classes) el.classList.add(cls);
      const overlay = document.createElement("div");
      overlay.className = "wmfa-overlay";
      overlay.setAttribute("aria-hidden", "true");
      card.append(overlay);
      const badge = document.createElement("span");
      badge.className = "wmfa-fa";
      badge.textContent = "FA";
      badge.title = "Full Art — apparence locale";
      badge.setAttribute("aria-label", "Full Art");
      const frame = document.createElement("span");
      frame.className = "wmfa-frame";
      frame.setAttribute("aria-hidden", "true");
      card.append(badge, frame);
      const placeBadge = () => {
        const rarity = [...card.children].find(
          (e) => e !== badge && rarities.has(e.textContent.trim()),
        );
        badge.style.top = `${rarity?.offsetTop || 8}px`;
        badge.style.left = `${(rarity?.offsetLeft || 8) + (rarity?.offsetWidth || 22) + 4}px`;
        badge.style.height = `${rarity?.offsetHeight || 20}px`;
      };
      placeBadge();
      const resize =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              placeBadge();
              layoutImage(card);
            })
          : null;
      resize?.observe(card);
      resize?.observe(portrait);
      const leave = () => {
        card.style.setProperty("--wmfa-x", "50%");
        card.style.setProperty("--wmfa-y", "30%");
        card.style.setProperty("--wmfa-angle", "0deg");
      };
      const move = (event) => {
        if (reduced.matches || event.pointerType === "touch") return;
        const r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
        card.style.setProperty("--wmfa-x", `${x * 100}%`);
        card.style.setProperty("--wmfa-y", `${y * 100}%`);
        card.style.setProperty("--wmfa-angle", `${(x - 0.5) * 5}deg`);
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      state = {
        classes,
        overlay,
        badge,
        frame,
        resize,
        move,
        leave,
        image,
        nativeImage,
        portrait,
        createdPortrait,
        autoHalo,
      };
      state.imageLoad = () => {
        layoutImage(card);
        state.autoHalo = imageHalo(image) || autoHalo;
        const custom = appearance(cardKey(card));
        card.style.setProperty(
          "--wmfa-halo",
          custom.haloColor || state.autoHalo,
        );
      };
      image.addEventListener("load", state.imageLoad);
      state.nativeLoad = () => decorate(card);
      nativeImage?.addEventListener("load", state.nativeLoad);
      tracked.set(card, state);
    }
    const custom = appearance(cardKey(card));
    card.classList.toggle("wmfa-full", custom.full === true);
    state.badge.hidden = custom.showBadge === false;
    card.classList.toggle("wmfa-tilt", custom.full === true && settings.tilt);
    card.dataset.wmfaEffect = custom.full === true ? settings.effect : "native";
    card.style.setProperty(
      "--wmfa-intensity",
      String(settings.intensity / 100),
    );
    const crop = framing(cardKey(card));
    card.style.setProperty("--wmfa-focus", `${crop.focus}%`);
    card.style.setProperty("--wmfa-focus-x", `${crop.focusX}%`);
    card.style.setProperty("--wmfa-zoom", String(crop.zoom / 100));
    card.classList.toggle(
      "wmfa-custom-halo",
      custom.full === true && custom.haloEnabled !== false,
    );
    card.classList.toggle(
      "wmfa-no-halo",
      custom.full === true && custom.haloEnabled === false,
    );
    card.style.setProperty("--wmfa-halo", custom.haloColor || state.autoHalo);
    const wanted =
      custom.customImage ||
      state.nativeImage?.currentSrc ||
      state.nativeImage?.src;
    state.portrait.classList.toggle("wmfa-has-image", Boolean(wanted));
    if (wanted && state.image.getAttribute("src") !== wanted) {
      state.image.src = wanted;
      if (state.image.complete) state.imageLoad();
    }
    if (!wanted) state.image.removeAttribute("src");
    layoutImage(card);
  }
  function layoutImage(card) {
    const state = tracked.get(card);
    if (!state) return;
    const { image, portrait } = state;
    const width = portrait.clientWidth,
      height = portrait.clientHeight;
    if (!image.naturalWidth || !image.naturalHeight || !width || !height)
      return;
    const crop = framing(cardKey(card));
    const scale =
      (Math.max(width / image.naturalWidth, height / image.naturalHeight) *
        crop.zoom) /
      100;
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    // Percentages span the entire overflow, so zoom never leaves blank edges.
    image.style.width = `${renderedWidth}px`;
    image.style.height = `${renderedHeight}px`;
    image.style.left = `${((width - renderedWidth) * crop.focusX) / 100}px`;
    image.style.top = `${((height - renderedHeight) * crop.focus) / 100}px`;
  }
  function buildControls(nodes) {
    return nodes.map((node) => {
      if (typeof node === "string") return node;
      const [tag, attributes, children] = node;
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes))
        element.setAttribute(name, value);
      element.append(...buildControls(children));
      return element;
    });
  }
  function syncLabels(candidates) {
    const wanted = new Set();
    for (const card of candidates) {
      if (!appearance(cardKey(card)).hideLabels) continue;
      const wrapper = card.closest("div.relative.isolate.group") || card;
      for (const label of wrapper.querySelectorAll("span.rounded-full")) {
        // The native rarity, lock and Full Art badge are not collection labels.
        if (label.closest(".absolute.top-2.left-2, .wm-lock-marker, .wmfa-fa"))
          continue;
        wanted.add(label);
        label.classList.add("wmfa-hidden-label");
      }
    }
    for (const label of hiddenLabels)
      if (!wanted.has(label)) label.classList.remove("wmfa-hidden-label");
    hiddenLabels.clear();
    for (const label of wanted) hiddenLabels.add(label);
  }
  function controls() {
    if (panel?.isConnected) return;
    const host = document.querySelector(".wm-tools-body");
    if (!host) return;
    panel = document.createElement("section");
    panel.className = "wmfa-panel";
    // Static extension-owned markup; no page strings are interpreted as HTML.
    panel.append(
      ...buildControls([
        [
          "div",
          { class: "wmfa-heading" },
          [["span", { "data-count": "" }, []]],
        ],
        [
          "div",
          { class: "wmfa-settings" },
          [
            [
              "label",
              {},
              [
                ["input", { type: "checkbox", name: "multipleSelection" }, []],
                " Sélectionner plusieurs cartes",
              ],
            ],
            [
              "button",
              {
                type: "button",
                "data-action": "pick-card",
                "aria-pressed": "false",
              },
              ["Personnaliser une carte"],
            ],
            [
              "div",
              { class: "wmfa-photo-row" },
              [
                [
                  "button",
                  {
                    type: "button",
                    "data-action": "select-visible",
                    class: "wmfa-secondary",
                  },
                  ["Toutes les cartes affichées"],
                ],
                [
                  "button",
                  {
                    type: "button",
                    "data-action": "clear-selection",
                    class: "wmfa-secondary",
                  },
                  ["Vider la sélection"],
                ],
              ],
            ],
            [
              "p",
              { "data-pick-hint": "", role: "status" },
              [
                "Choisis directement une carte dans la collection ou la vitrine.",
              ],
            ],
            [
              "div",
              { class: "wmfa-selected", "data-selected-card": "" },
              ["Aucune carte sélectionnée"],
            ],
            [
              "div",
              { "data-card-editor": "", hidden: "" },
              [
                [
                  "p",
                  { "data-group-hint": "", hidden: "" },
                  [
                    "Ces réglages s’appliquent à toute la sélection. Une case avec un trait indique des valeurs différentes. La photo et le cadrage se règlent sur une seule carte à la fois.",
                  ],
                ],
                [
                  "label",
                  { class: "wm-feature" },
                  [
                    [
                      "span",
                      {},
                      [
                        ["strong", {}, ["Afficher le badge FA"]],
                        [
                          "small",
                          {},
                          ["Visible uniquement sur les cartes en Full Art"],
                        ],
                      ],
                    ],
                    ["input", { type: "checkbox", name: "showBadge" }, []],
                  ],
                ],
                [
                  "label",
                  { class: "wm-feature" },
                  [
                    [
                      "span",
                      {},
                      [
                        ["strong", {}, ["Masquer les étiquettes"]],
                        [
                          "small",
                          {},
                          ["Les étiquettes restent attribuées aux cartes"],
                        ],
                      ],
                    ],
                    ["input", { type: "checkbox", name: "hideLabels" }, []],
                  ],
                ],
                [
                  "label",
                  { class: "wm-feature" },
                  [
                    [
                      "span",
                      {},
                      [
                        ["strong", {}, ["Full Art"]],
                        ["small", {}, ["Étendre l’image sur toute la carte"]],
                      ],
                    ],
                    [
                      "input",
                      { type: "checkbox", name: "cardFull", role: "switch" },
                      [],
                    ],
                  ],
                ],
                [
                  "label",
                  { class: "wm-feature" },
                  [
                    [
                      "span",
                      {},
                      [
                        ["strong", {}, ["Halo"]],
                        ["small", {}, ["Lueur autour de cette carte"]],
                      ],
                    ],
                    [
                      "input",
                      { type: "checkbox", name: "haloEnabled", role: "switch" },
                      [],
                    ],
                  ],
                ],
                [
                  "label",
                  {},
                  [
                    "Couleur du halo (choix manuel)",
                    [
                      "input",
                      { type: "color", name: "haloColor", value: "#f4d080" },
                      [],
                    ],
                  ],
                ],
                [
                  "button",
                  {
                    type: "button",
                    "data-action": "reset-halo",
                    class: "wmfa-secondary",
                  },
                  ["Halo automatique"],
                ],
                [
                  "section",
                  { class: "wmfa-framing" },
                  [
                    ["strong", {}, ["Cadrage de cette carte"]],
                    [
                      "small",
                      {},
                      [
                        "Photo d’origine ou importée · aperçu immédiat, avec ou sans Full Art. Le déplacement dépend du débordement de la photo ; augmente le zoom pour la déplacer davantage.",
                      ],
                    ],
                    [
                      "label",
                      {},
                      [
                        "Horizontal ",
                        ["output", { "data-value": "focusX" }, []],
                        [
                          "input",
                          {
                            type: "range",
                            name: "focusX",
                            min: "0",
                            max: "100",
                          },
                          [],
                        ],
                      ],
                    ],
                    [
                      "label",
                      {},
                      [
                        "Vertical ",
                        ["output", { "data-value": "focus" }, []],
                        [
                          "input",
                          {
                            type: "range",
                            name: "focus",
                            min: "0",
                            max: "100",
                          },
                          [],
                        ],
                      ],
                    ],
                    [
                      "label",
                      {},
                      [
                        "Zoom ",
                        ["output", { "data-value": "zoom" }, []],
                        [
                          "input",
                          {
                            type: "range",
                            name: "zoom",
                            min: "100",
                            max: "250",
                          },
                          [],
                        ],
                      ],
                    ],
                    [
                      "button",
                      {
                        type: "button",
                        "data-action": "reset-framing",
                        class: "wmfa-secondary",
                      },
                      ["Réinitialiser le cadrage"],
                    ],
                  ],
                ],
                [
                  "details",
                  { class: "wmfa-effects" },
                  [
                    ["summary", {}, ["Effets communs à toutes les cartes"]],
                    [
                      "label",
                      {},
                      [
                        "Reflet supplémentaire",
                        [
                          "select",
                          { name: "effect" },
                          [
                            [
                              "option",
                              { value: "native" },
                              ["Brillance du site uniquement"],
                            ],
                            [
                              "option",
                              { value: "prism" },
                              ["Holographique arc-en-ciel"],
                            ],
                            ["option", { value: "gold" }, ["Reflet doré"]],
                            ["option", { value: "stars" }, ["Scintillements"]],
                          ],
                        ],
                      ],
                    ],
                    [
                      "label",
                      {},
                      [
                        "Intensité des effets ajoutés",
                        [
                          "input",
                          {
                            type: "range",
                            name: "intensity",
                            min: "0",
                            max: "100",
                          },
                          [],
                        ],
                      ],
                    ],
                    [
                      "label",
                      {},
                      [
                        ["input", { type: "checkbox", name: "tilt" }, []],
                        " Inclinaison légère au survol",
                      ],
                    ],
                  ],
                ],
                [
                  "section",
                  { class: "wmfa-upload", "aria-label": "Image de la carte" },
                  [
                    ["strong", {}, ["Image de la carte"]],
                    [
                      "img",
                      {
                        "data-photo-preview": "",
                        hidden: "",
                        alt: "Aperçu de l’image personnalisée",
                      },
                      [],
                    ],
                    ["p", { "data-photo-caption": "" }, []],
                    [
                      "input",
                      {
                        type: "file",
                        name: "photo",
                        accept:
                          "image/png,image/jpeg,image/webp,image/gif,image/avif",
                        hidden: "",
                      },
                      [],
                    ],
                    [
                      "button",
                      { type: "button", "data-action": "choose-photo" },
                      ["Choisir une image…"],
                    ],
                    [
                      "small",
                      {},
                      [
                        "8 Mo maximum · image optimisée à 1 200 px. Les animations deviennent une image fixe. Visible avec ou sans Full Art.",
                      ],
                    ],
                    [
                      "p",
                      {
                        "data-photo-status": "",
                        role: "status",
                        "aria-live": "polite",
                      },
                      [],
                    ],
                  ],
                ],
                [
                  "div",
                  { class: "wmfa-photo-row" },
                  [
                    [
                      "button",
                      {
                        type: "button",
                        "data-action": "reset-photo",
                        class: "wmfa-secondary",
                      },
                      ["Retirer la photo"],
                    ],
                    [
                      "button",
                      { type: "button", "data-action": "reset-all" },
                      ["Réinitialiser tout"],
                    ],
                  ],
                ],
                [
                  "small",
                  {},
                  [
                    "Désactive « Full Art » pour garder le format classique. Utilise « Retirer la photo » pour retrouver l’image d’origine. La photo importée reste sur ton appareil, elle n’est jamais envoyée. Aucun changement pour les autres joueurs.",
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    );
    const fullLabel = panel.querySelector('[name="cardFull"]').closest("label");
    const badgeLabel = panel
      .querySelector('[name="showBadge"]')
      .closest("label");
    const fullOptions = document.createElement("div");
    fullOptions.dataset.fullArtOptions = "";
    fullLabel.parentElement.insertBefore(fullLabel, badgeLabel);
    fullOptions.append(
      badgeLabel,
      panel.querySelector('[name="haloEnabled"]').closest("label"),
    );
    const haloOptions = document.createElement("details");
    haloOptions.dataset.haloOptions = "";
    haloOptions.className = "wmfa-submenu";
    const haloSummary = document.createElement("summary");
    haloSummary.textContent = "Réglages du halo";
    haloOptions.append(
      haloSummary,
      panel.querySelector('[name="haloColor"]').closest("label"),
      panel.querySelector('[data-action="reset-halo"]'),
    );
    fullOptions.append(haloOptions);
    fullLabel.after(fullOptions);
    const editor = panel.querySelector("[data-card-editor]");
    const appearanceSection = document.createElement("section");
    appearanceSection.className = "wmfa-section";
    const appearanceTitle = document.createElement("h4");
    appearanceTitle.textContent = "Style des cartes";
    appearanceSection.append(
      appearanceTitle,
      fullLabel,
      fullOptions,
      panel.querySelector('[name="hideLabels"]').closest("label"),
    );
    const imageSection = document.createElement("details");
    imageSection.dataset.imageSection = "";
    imageSection.className = "wmfa-section wmfa-image-section";
    imageSection.open = true;
    const imageSummary = document.createElement("summary");
    imageSummary.textContent = "Image et cadrage";
    const upload = panel.querySelector(".wmfa-upload");
    upload.append(panel.querySelector('[data-action="reset-photo"]'));
    imageSection.append(
      imageSummary,
      upload,
      panel.querySelector(".wmfa-framing"),
    );
    const effects = panel.querySelector(".wmfa-effects");
    const resetRow = panel.querySelector(".wmfa-photo-row:last-of-type");
    const resetButton = panel.querySelector('[data-action="reset-all"]');
    resetButton.textContent = "Réinitialiser toutes les apparences";
    resetButton.classList.add("wmfa-secondary");
    editor.insertBefore(
      appearanceSection,
      editor.querySelector("[data-group-hint]").nextSibling,
    );
    appearanceSection.after(imageSection);
    imageSection.after(effects);
    // Keep the global reset separate from the selected card's photo controls.
    if (resetRow?.contains(resetButton)) effects.after(resetRow);
    count = panel.querySelector("[data-count]");
    panel
      .querySelector('[data-action="pick-card"]')
      .addEventListener("click", () => setPicking(!picking));
    panel
      .querySelector('[data-action="select-visible"]')
      .addEventListener("click", () => {
        multipleSelection = true;
        panel.querySelector('[name="multipleSelection"]').checked = true;
        selection.clear();
        for (const card of candidatesOnPage()) {
          if (
            !card.getClientRects().length ||
            getComputedStyle(card).visibility === "hidden"
          )
            continue;
          selection.set(
            cardKey(card),
            card.querySelector("h3").textContent.trim(),
          );
        }
        selectionChanged();
      });
    panel
      .querySelector('[data-action="clear-selection"]')
      .addEventListener("click", () => {
        selection.clear();
        selectionChanged();
      });
    panel.addEventListener("input", (event) => {
      const input = event.target;
      if (input.name === "photo") return;
      if (input.name === "multipleSelection") {
        multipleSelection = input.checked;
        if (!multipleSelection && selection.size > 1) selection.clear();
        selectionChanged();
        return;
      }
      if (["showBadge", "hideLabels"].includes(input.name)) {
        updateSelection({ [input.name]: input.checked });
        return;
      }
      if (input.name === "cardFull") {
        updateSelection({ full: input.checked });
        return;
      }
      if (input.name === "haloEnabled") {
        updateSelection({ haloEnabled: input.checked });
        return;
      }
      if (["focus", "focusX", "zoom"].includes(input.name)) {
        if (selectedCard)
          updateCard(selectedCard, { [input.name]: Number(input.value) });
        return;
      }
      if (input.name === "haloColor") {
        updateSelection({ haloColor: input.value });
        return;
      }
      if (!Object.hasOwn(defaults, input.name)) return;
      settings[input.name] =
        input.type === "checkbox"
          ? input.checked
          : input.type === "range"
            ? Number(input.value)
            : input.value;
      settings = sanitize(settings);
      save();
      scan();
    });
    const fileInput = panel.querySelector('input[name="photo"]');
    panel.addEventListener("change", (event) => {
      if (["focus", "focusX", "zoom"].includes(event.target.name)) void save();
    });
    panel
      .querySelector('[data-action="choose-photo"]')
      .addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0],
        key = selectedCard;
      const status = panel.querySelector("[data-photo-status]");
      if (!file || !key) return;
      const operation = ++imageImport;
      status.textContent = "Préparation de l’image…";
      try {
        const image = await WMImageTools.prepare(file);
        if (operation !== imageImport) return;
        settings.cards[key] = { ...appearance(key), customImage: image };
        scan();
        const saved = await save();
        status.textContent = saved
          ? "Image enregistrée pour « " + key + " »."
          : "Image affichée mais non enregistrée. Réessaie.";
      } catch (error) {
        if (operation === imageImport)
          status.textContent =
            error.message || "Impossible de préparer cette image.";
      } finally {
        event.target.value = "";
      }
    });
    panel
      .querySelector('[data-action="reset-photo"]')
      .addEventListener("click", () => {
        imageImport++;
        if (selectedCard) updateCard(selectedCard, { customImage: null });
      });
    panel
      .querySelector('[data-action="reset-framing"]')
      .addEventListener("click", () => {
        if (selectedCard)
          updateCard(selectedCard, { focus: 30, focusX: 50, zoom: 100 });
      });
    panel
      .querySelector('[data-action="reset-halo"]')
      .addEventListener("click", () => {
        updateSelection({ haloColor: null });
      });
    panel
      .querySelector('[data-action="reset-all"]')
      .addEventListener("click", () => {
        imageImport++;
        settings = { ...defaults, cards: {} };
        sync();
        save();
        scan();
      });
    host.append(panel);
    sync();
  }
  function sync() {
    if (!panel) return;
    for (const [key, value] of Object.entries(settings)) {
      if (["customImage", "cards", "focus", "focusX"].includes(key)) continue;
      const input = panel.querySelector(`[name="${key}"]`);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = value;
      else input.value = String(value);
    }
  }
  async function save() {
    clearTimeout(framingSave);
    const snapshot = structuredClone(settings);
    try {
      const write = saveQueue.then(() =>
        browser.storage.local.set({ wmFullArt: snapshot }),
      );
      saveQueue = write.catch(() => {}); // A failed write must not block subsequent saves.
      await write;
      return true;
    } catch {
      const status = panel?.querySelector("[data-photo-status]");
      if (status)
        status.textContent =
          "Impossible d’enregistrer les réglages sur cet appareil.";
      return false;
    }
  }
  function scan() {
    if (!document.body) return;
    const active = enabled() && supported();
    if (active) controls();
    else {
      setPicking(false);
      panel?.remove();
      panel = null;
    }
    const candidates = active
      ? candidatesOnPage().filter((c) => cardKey(c))
      : [];
    syncCards(candidates);
    syncLabels(candidates);
    for (const card of [...tracked.keys()])
      if (
        !customized(cardKey(card)) ||
        !candidates.includes(card) ||
        !card.isConnected
      )
        restore(card);
    for (const card of candidates)
      if (customized(cardKey(card))) decorate(card);
    if (count) {
      const value = `${candidates.length} carte${candidates.length > 1 ? "s" : ""}`;
      if (count.textContent !== value) count.textContent = value;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 80);
  }
  globalThis.WMPageEvents?.subscribe(schedule);
  globalThis.WMFeatures?.subscribe(scan);
  addEventListener("popstate", schedule);
  browser.storage.local
    .get("wmFullArt")
    .then((result) => {
      settings = sanitize(result.wmFullArt);
      if (result.wmFullArt?.customImage) void save();
      sync();
      scan();
    })
    .catch(scan);
})();
