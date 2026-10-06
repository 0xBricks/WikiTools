(() => {
  "use strict";
  let session = null,
    scheduled = false,
    busy = false;
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const setText = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  function nativeAction(button) {
    const raw = button.wrappedJSObject;
    if (!raw) return null;
    try {
      const property = Object.keys(raw).find((name) =>
        name.startsWith("__reactProps$"),
      );
      const handler = raw[property]?.onClick;
      if (typeof handler !== "function") return null;
      // Retain the original handler and its selected-card closure. The site's
      // first successful application may unmount the entire label popup.
      // click() discards React's async return value. A successful HTTP response
      // can precede the site's refresh and busy-state cleanup, so the next click
      // would hit a disabled button. Preserve and await the original action for
      // every row, including rows still mounted during that refresh.
      return () => handler();
    } catch {
      return null;
    }
  }
  function findPopup() {
    for (const heading of document.querySelectorAll("h2")) {
      if (
        !/^appliquer (une etiquette|des etiquettes)$/.test(
          normalize(heading.textContent),
        )
      )
        continue;
      let root = heading.parentElement;
      for (let i = 0; root && i < 5; i++, root = root.parentElement) {
        const input = root.querySelector(
          'input[placeholder="Chercher ou créer une étiquette…"]',
        );
        const list = root.querySelector("div.max-h-64.overflow-y-auto");
        if (input && list) return { root, list, heading };
      }
    }
    return null;
  }
  function render() {
    if (!session) return;
    const { rows, selected, apply } = session;
    for (const [button, job] of rows) {
      const checked = String(selected.has(job.name));
      if (button.getAttribute("aria-checked") !== checked)
        button.setAttribute("aria-checked", checked);
    }
    apply.disabled = busy || !selected.size;
    setText(apply, `Appliquer (${selected.size})`);
  }
  function restore() {
    if (!session) return;
    for (const [button, original] of session.originals) {
      button.classList.remove("wm-label-option");
      for (const [name, value] of Object.entries(original)) {
        if (value === null) button.removeAttribute(name);
        else button.setAttribute(name, value);
      }
    }
    setText(session.heading, session.originalHeading);
    session.footer.remove();
    session = null;
  }
  function sync() {
    scheduled = false;
    if (busy) return;
    if (!WMFeatures.enabled("multiLabels")) {
      restore();
      return;
    }
    if (!/^\/collection\/?$/.test(location.pathname)) {
      session = null;
      return;
    }
    const popup = findPopup();
    if (!popup) {
      session = null;
      return;
    }
    if (session?.root !== popup.root) {
      const footer = document.createElement("div");
      footer.className = "wm-label-footer";
      const hint = document.createElement("span");
      hint.textContent = "Cochez une ou plusieurs étiquettes.";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "wm-label-apply";
      apply.addEventListener("click", execute);
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      footer.append(hint, apply, status);
      popup.root.append(footer);
      session = {
        ...popup,
        footer,
        originalHeading: popup.heading.textContent,
        originals: new Map(),
        selected: new Map(),
        rows: new Map(),
        apply,
        status,
      };
    }
    setText(popup.heading, "Appliquer des étiquettes");
    session.rows.clear();
    for (const button of popup.list.querySelectorAll("button")) {
      const name = button
        .querySelector("span.rounded-full")
        ?.textContent.trim();
      const run = nativeAction(button);
      if (!name || !run || button.disabled) continue;
      const job = { name, run };
      session.rows.set(button, job);
      if (session.selected.has(name)) session.selected.set(name, job);
      if (!button.classList.contains("wm-label-option")) {
        session.originals.set(button, {
          role: button.getAttribute("role"),
          "aria-checked": button.getAttribute("aria-checked"),
        });
        button.classList.add("wm-label-option");
        button.setAttribute("role", "checkbox");
      }
    }
    render();
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      setTimeout(sync, 0);
    }
  }
  function visibleConfirmation(root, name) {
    const selector = "div.relative.isolate.group";
    const identity = (card) =>
      JSON.stringify([
        card.querySelector("h3")?.textContent.trim(),
        card
          .querySelector("div.absolute.top-2.left-2")
          ?.textContent.replace(/🔒/g, "")
          .trim(),
      ]);
    const cards = [...document.querySelectorAll(selector)];
    const selected = cards.filter((card) =>
      [...card.children].some(
        (child) =>
          child.matches?.(
            'span.pointer-events-none.absolute[aria-hidden="true"]',
          ) &&
          child.classList.contains("border-2") &&
          child.querySelector("svg.lucide-check"),
      ),
    );
    // Ambiguous duplicate cards or a hidden selection require network confirmation.
    const targets = selected.map(identity);
    const hasLabel = (card) =>
      [...card.querySelectorAll("span.rounded-full")].some(
        (label) => label.textContent.trim() === name,
      );
    const eligible =
      targets.length > 0 &&
      targets.every(
        (key) => cards.filter((card) => identity(card) === key).length === 1,
      ) &&
      selected.some((card) => !hasLabel(card));
    return () => {
      if (!eligible || root.isConnected) return false;
      const current = [...document.querySelectorAll(selector)];
      return targets.every((key) => {
        const matches = current.filter((card) => identity(card) === key);
        return matches.length === 1 && hasLabel(matches[0]);
      });
    };
  }
  function exitSelection() {
    const buttons = [...document.querySelectorAll("button")].filter(
      (button) =>
        !button.disabled &&
        button.getClientRects().length &&
        !button.closest(
          '.wm-label-progress, .wm-toolbar, .wm-native-lock-actions, [role="dialog"], dialog',
        ),
    );
    const exact = buttons.filter((button) =>
      /^(annuler la selection|quitter la selection|terminer la selection)$/.test(
        normalize(button.textContent),
      ),
    );
    if (exact.length === 1) {
      exact[0].click();
      return true;
    }
    // Some versions label the collection's exit button simply "Annuler".
    const candidates = buttons.filter(
      (button) =>
        /^(annuler|terminer)$/.test(normalize(button.textContent)) &&
        [...(button.parentElement?.querySelectorAll("button") ?? [])].some(
          (sibling) =>
            /^(tout selectionner|tout deselectionner)/.test(
              normalize(sibling.textContent),
            ),
        ),
    );
    if (candidates.length === 1) {
      candidates[0].click();
      return true;
    }
    const cancel = buttons.filter(
      (button) => normalize(button.textContent) === "annuler",
    );
    if (cancel.length === 1) {
      cancel[0].click();
      return true;
    }
    return !buttons.some((button) =>
      /^(tout selectionner|tout deselectionner)/.test(
        normalize(button.textContent),
      ),
    );
  }
  async function execute(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || !WMFeatures.enabled("multiLabels") || !session?.selected.size)
      return;
    const active = session,
      jobs = [...active.selected.values()].map((job) => ({
        ...job,
        confirmed: visibleConfirmation(active.root, job.name),
      }));
    busy = true;
    render();
    active.footer.hidden = true;
    try {
      await WMLabelBatch.apply(jobs);
      active.selected.clear();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (!active.root.isConnected) exitSelection();
    } catch (error) {
      active.footer.hidden = false;
      const overlay = document.createElement("div");
      overlay.className = "wm-label-progress";
      const panel = document.createElement("div"),
        message = document.createElement("span");
      message.setAttribute("role", "status");
      panel.append(message);
      overlay.append(panel);
      document.body.append(overlay);
      message.textContent = `${error.completed ?? 0}/${jobs.length} étiquette(s) appliquée(s). ${error.message}`;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Fermer";
      close.addEventListener("click", () => overlay.remove());
      panel.append(close);
      for (const job of jobs.slice(0, error.completed ?? 0))
        active.selected.delete(job.name);
    } finally {
      busy = false;
      schedule();
    }
  }
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.("button");
      const job = session?.rows.get(button);
      if (
        !job ||
        !session.root.isConnected ||
        (!busy && !WMFeatures.enabled("multiLabels"))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy) return;
      if (session.selected.has(job.name)) session.selected.delete(job.name);
      else session.selected.set(job.name, job);
      render();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (busy && /^\/collection\/?$/.test(location.pathname)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  new MutationObserver((records) => {
    if (!/^\/collection\/?$/.test(location.pathname) && !session) return;
    if (
      records.some(
        (record) =>
          !record.target.closest?.(".wm-label-footer, .wm-label-progress"),
      )
    )
      schedule();
  }).observe(document, { childList: true, subtree: true, characterData: true });
  WMFeatures.subscribe(schedule);
  schedule();
})();
