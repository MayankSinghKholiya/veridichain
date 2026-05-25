// ── Global toast helper ───────────────────────────────────────
// Fire a CustomEvent that ToastContainer (in Providers) listens for.
// No context or prop-drilling needed — call showToast() from anywhere.
// ─────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

export function showToast(message: string, type: ToastType = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("veridi:toast", { detail: { message, type } })
  );
}
