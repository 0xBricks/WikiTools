(() => {
  "use strict";
  const MAX_INPUT = 8 * 1024 * 1024,
    MAX_SIDE = 1200,
    MAX_PIXELS = 32 * 1024 * 1024;
  async function prepare(file) {
    if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(file?.type ?? ""))
      throw new Error("Choisis une image PNG, JPEG, WebP, GIF ou AVIF.");
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_INPUT)
      throw new Error("L’image doit peser moins de 8 Mo.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Cette image est illisible. Essaie un autre fichier.");
    }
    try {
      if (
        !bitmap.width ||
        !bitmap.height ||
        bitmap.width * bitmap.height > MAX_PIXELS
      )
        throw new Error("Image trop grande : 32 mégapixels maximum.");
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Le navigateur ne peut pas préparer cette image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const output = canvas.toDataURL("image/webp", 0.85);
      if (!output.startsWith("data:image/") || output.length > 1400000)
        throw new Error(
          "Image encore trop lourde après compression. Choisis une image plus simple.",
        );
      return output;
    } finally {
      bitmap.close();
    }
  }
  globalThis.WMImageTools = Object.freeze({ prepare });
})();
