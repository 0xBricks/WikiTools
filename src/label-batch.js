(() => {
  "use strict";
  let running = false;
  async function apply(jobs, progress = () => {}) {
    if (running) throw new Error("Une application est déjà en cours.");
    if (!jobs.length || jobs.some((job) => typeof job.run !== "function"))
      throw new Error("Sélection d’étiquettes invalide.");
    running = true;
    let completed = 0;
    try {
      for (const job of jobs) {
        if (!/^\/collection\/?$/.test(location.pathname))
          throw new Error("La collection a été quittée.");
        progress(completed, jobs.length, job.name);
        // Firefox observes native fetch and XHR, without changing any request.
        const watch = await browser.runtime.sendMessage({
          type: "wm-label-watch-start",
        });
        if (!watch?.token)
          throw new Error(
            watch?.error ??
              "Impossible de suivre l’application. Rechargez l’extension.",
          );
        let timer,
          visibleTimer,
          cancelled = false;
        try {
          const nativeResult = job.run();
          const checkVisible = async () => {
            if (cancelled || typeof job.confirmed !== "function") return;
            try {
              if (job.confirmed())
                await browser.runtime.sendMessage({
                  type: "wm-label-watch-visible",
                  token: watch.token,
                });
            } catch {
              /* Keep waiting for the native network result. */
            }
            if (!cancelled) visibleTimer = setTimeout(checkVisible, 50);
          };
          visibleTimer = setTimeout(checkVisible, 50);
          const result = await Promise.race([
            Promise.all([
              nativeResult,
              browser.runtime.sendMessage({
                type: "wm-label-watch-wait",
                token: watch.token,
              }),
            ]),
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Réponse du site trop longue. Vérifiez vos cartes avant de réessayer.",
                    ),
                  ),
                25000,
              );
            }),
          ]);
          if (!result[1]?.ok)
            throw new Error(result[1]?.error ?? "Application non confirmée.");
        } finally {
          cancelled = true;
          clearTimeout(visibleTimer);
          clearTimeout(timer);
          await browser.runtime
            .sendMessage({ type: "wm-label-watch-cancel", token: watch.token })
            .catch(() => {
              /* Background watch may already have expired. */
            });
        }
        completed++;
      }
      return completed;
    } catch (error) {
      error.completed = completed;
      throw error;
    } finally {
      running = false;
    }
  }
  globalThis.WMLabelBatch = Object.freeze({ apply });
})();
