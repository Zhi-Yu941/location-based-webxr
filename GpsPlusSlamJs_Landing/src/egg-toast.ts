/**
 * Transient egg toast (easter-egg catalog №1): a tiny `role="status"`
 * pill that names what an egg just did ("Cache found…"), then fades.
 * The page had no generic toast channel — this is the minimal one,
 * styled in index.html to match the `.qr-caption` voice. Deliberately
 * dependency-free and seam-injected (the unit suite runs in node).
 */

export const EGG_TOAST_ID = "egg-toast";
export const EGG_TOAST_VISIBLE_MS = 2600;

/** The slice of Document the toast needs (injectable for node tests). */
export interface ToastDocument {
  getElementById(id: string): HTMLElement | null;
  createElement(tag: string): HTMLElement;
  readonly body: { appendChild(node: HTMLElement): unknown };
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show `message` in the (lazily created) toast element; re-showing
 * resets the hide timer. Visibility is class-driven (`.visible`) so the
 * CSS owns the fade.
 */
export function showEggToast(
  message: string,
  doc: ToastDocument = document,
): void {
  let el = doc.getElementById(EGG_TOAST_ID);
  if (!el) {
    el = doc.createElement("div");
    el.id = EGG_TOAST_ID;
    el.setAttribute("role", "status");
    doc.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("visible");
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    el.classList.remove("visible");
    hideTimer = null;
  }, EGG_TOAST_VISIBLE_MS);
}
