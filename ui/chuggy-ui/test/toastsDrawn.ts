/**
 * The toasts the shell draws, as a case reads them: each one's tone and its
 * line, in the order they stand.
 */

export interface ToastDrawn {
  readonly tone: string | null;
  readonly line: string | null;
}

export function toastsDrawn(): readonly ToastDrawn[] {
  return [...document.querySelectorAll(".toast")].map((toast) => ({
    tone: toast.getAttribute("data-tone"),
    line: toast.querySelector(".toast-line")?.textContent ?? null,
  }));
}
