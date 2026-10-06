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
  const enabled = () => !globalThis.WMFeatures || WMFeatures.enabled("fullArt");
  let selectedCard = "",
    selectedLabel = "",
    picking = false,
    imageImport = 0;
  const pickTargets = new Set();
  function setPicking(value) {
    picking = value && enabled();
    for (const card of pickTargets) card.classList.remove("wmfa-pickable");
    pickTargets.clear();
    if (picking)
      for (const card of candidatesOnPage()) {
        card.classList.add("wmfa-pickable");
        pickTargets.add(card);
      }
    if (panel) {
      const button = panel.querySelector('[data-action="pick-card"]');
      button.textContent = picking
        ? "Annuler la sélection"
        : selectedCard
          ? "Changer de carte"
          : "Personnaliser une carte";
      button.setAttribute("aria-pressed", String(picking));
      panel.querySelector("[data-pick-hint]").textContent = picking
        ? "Clique sur une carte dans la page. Échap pour annuler."
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
    selectedCard = cardKey(card);
    selectedLabel = card.querySelector("h3").textContent.trim();
    setPicking(false);
    scan();
    const tools = panel?.closest(".wm-tools");
    if (tools) tools.open = true;
    panel?.querySelector('[name="cardFull"]').focus();
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
              card.querySelector("img") &&
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
    save();
    scan();
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
    panel.querySelector("[data-selected-card]").textContent =
      selectedLabel || "Aucune carte sélectionnée";
    panel.querySelector("[data-card-editor]").hidden = !selectedCard;
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
    state.overlay.remove();
    state.badge.remove();
    state.frame.remove();
    state.resize?.disconnect();
    if (state.image && state.originalSrc) state.image.src = state.originalSrc;
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
    if (!state) {
      const heading = card.querySelector("h3");
      const content = heading?.parentElement;
      const portrait = [...card.children].find(
        (e) => e.tagName === "DIV" && e.querySelector("img"),
      );
      if (!heading || !content || !portrait || content.parentElement !== card)
        return;
      const image = portrait.querySelector("img");
      const autoHalo = automaticHalo(card);
      const classes = [
        [card, "wmfa-card"],
        [portrait, "wmfa-portrait"],
        [image, "wmfa-image"],
        [content, "wmfa-content"],
      ];
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
          ? new ResizeObserver(placeBadge)
          : null;
      resize?.observe(card);
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
        autoHalo,
        originalSrc: image.src,
      };
      state.imageLoad = () => {
        state.autoHalo = imageHalo(image) || autoHalo;
        const custom = appearance(cardKey(card));
        card.style.setProperty(
          "--wmfa-halo",
          custom.haloColor || state.autoHalo,
        );
      };
      image.addEventListener("load", state.imageLoad);
      state.imageLoad();
      tracked.set(card, state);
    }
    card.classList.add("wmfa-full");
    card.classList.toggle("wmfa-tilt", settings.tilt);
    card.dataset.wmfaEffect = settings.effect;
    card.style.setProperty(
      "--wmfa-intensity",
      String(settings.intensity / 100),
    );
    const crop = framing(cardKey(card));
    card.style.setProperty("--wmfa-focus", `${crop.focus}%`);
    card.style.setProperty("--wmfa-focus-x", `${crop.focusX}%`);
    card.style.setProperty("--wmfa-zoom", String(crop.zoom / 100));
    const custom = appearance(cardKey(card));
    card.classList.toggle("wmfa-custom-halo", custom.haloEnabled !== false);
    card.classList.toggle("wmfa-no-halo", custom.haloEnabled === false);
    card.style.setProperty("--wmfa-halo", custom.haloColor || state.autoHalo);
    const wanted = custom.customImage || state.originalSrc;
    if (state.image.src !== wanted) {
      state.image.src = wanted;
      if (state.image.complete) state.imageLoad();
    }
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
              "button",
              {
                type: "button",
                "data-action": "pick-card",
                "aria-pressed": "false",
              },
              ["Personnaliser une carte"],
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
                        "Photo d’origine ou importée · aperçu directement sur la carte en Full Art.",
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
                        "8 Mo maximum · image optimisée à 1 200 px. Les animations deviennent une image fixe. Active le Full Art pour l’afficher.",
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
                    "Désactive « Full Art » pour retrouver son apparence originale. La photo importée reste sur ton appareil, elle n’est jamais envoyée. Aucun changement pour les autres joueurs.",
                  ],
                ],
              ],
            ],
          ],
        ],
      ]),
    );
    count = panel.querySelector("[data-count]");
    panel
      .querySelector('[data-action="pick-card"]')
      .addEventListener("click", () => setPicking(!picking));
    panel.addEventListener("input", (event) => {
      const input = event.target;
      if (input.name === "photo") return;
      if (input.name === "cardFull") {
        if (selectedCard) updateCard(selectedCard, { full: input.checked });
        return;
      }
      if (input.name === "haloEnabled") {
        if (selectedCard)
          updateCard(selectedCard, { haloEnabled: input.checked });
        return;
      }
      if (["focus", "focusX", "zoom"].includes(input.name)) {
        if (selectedCard)
          updateCard(selectedCard, { [input.name]: Number(input.value) });
        return;
      }
      if (input.name === "haloColor") {
        if (selectedCard) updateCard(selectedCard, { haloColor: input.value });
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
        const saved = await save();
        scan();
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
        if (selectedCard) updateCard(selectedCard, { haloColor: null });
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
    try {
      await browser.storage.local.set({ wmFullArt: settings });
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
    for (const card of [...tracked.keys()])
      if (
        appearance(cardKey(card)).full !== true ||
        !candidates.includes(card) ||
        !card.isConnected
      )
        restore(card);
    for (const card of candidates)
      if (appearance(cardKey(card)).full === true) decorate(card);
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
