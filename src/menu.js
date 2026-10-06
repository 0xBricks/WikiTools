(() => {
  "use strict";
  function mount(toolbar) {
    const details = document.createElement("details");
    details.className = "wm-tools";
    const summary = document.createElement("summary");
    summary.textContent = "Outils Wiki";
    const body = document.createElement("div");
    body.className = "wm-tools-body";
    const switches = [];
    for (const [name, title, description] of [
      ["locks", "Cadenas", "Protéger mes cartes de la vente et de la défausse"],
      ["market", "Marché", "Rester dans la collection après une vente"],
      [
        "multiLabels",
        "Multi-étiquettes",
        "Appliquer plusieurs étiquettes en une seule sélection",
      ],
      [
        "pullsKeyboard",
        "Raccourcis clavier",
        "Entrée et flèches pendant les tirages",
      ],
      [
        "fullArt",
        "Apparence des cartes",
        "Activer mes personnalisations Full Art",
      ],
    ]) {
      const label = document.createElement("label");
      label.className = "wm-feature";
      const copy = document.createElement("span");
      const heading = document.createElement("strong");
      heading.textContent = title;
      const hint = document.createElement("small");
      hint.textContent = description;
      copy.append(heading, hint);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.disabled = true;
      input.addEventListener("change", async () => {
        input.disabled = true;
        try {
          await WMFeatures.set(name, input.checked);
          error.textContent = "";
        } catch {
          error.textContent = "Impossible d’enregistrer ce réglage.";
        } finally {
          input.checked = WMFeatures.enabled(name);
          input.disabled = false;
        }
      });
      label.append(copy, input);
      body.append(label);
      switches.push([name, input]);
    }
    const error = document.createElement("span");
    error.className = "wm-lock-notice";
    error.setAttribute("role", "status");
    const unavailable = () => {
      error.textContent =
        "Cadenas indisponibles : rechargez l’extension. Les ventes et défausses sont bloquées par précaution.";
    };
    browser.runtime?.onMessage?.addListener((message) => {
      if (message?.type === "wm-locks-unavailable") unavailable();
    });
    browser.runtime
      ?.sendMessage({ type: "wm-locks-ready" })
      ?.catch(unavailable);
    body.append(error);
    details.append(summary, body);
    toolbar.append(details);
    const render = () => {
      if (!toolbar.isConnected) return;
      for (const [name, input] of switches)
        input.checked = WMFeatures.enabled(name);
    };
    WMFeatures.subscribe(render);
    WMFeatures.whenReady
      .then(() => {
        for (const [, input] of switches) input.disabled = false;
        render();
      })
      .catch(() => {
        error.textContent = "Réglages indisponibles.";
      });
    render();
  }
  globalThis.WMMenu = Object.freeze({ mount });
})();
