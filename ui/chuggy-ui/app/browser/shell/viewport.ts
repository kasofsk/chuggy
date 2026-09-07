/**
 * Which of the console's widths the viewport is at. Each of these changes what
 * the shell draws and not only how it looks — the rail is a nav beside the page
 * or a dialog over it, the details are an aside or the whole middle — so the
 * answer is read here rather than left to a sheet.
 */

import { useCallback, useSyncExternalStore } from "react";

/** The console's breakpoints, in the `em` its sheets state them in. */
export const viewportTwoColumnEm = 60;
export const viewportDeskEm = 80;

export function useViewportAtLeastEm(em: number): boolean {
  const query = `(min-width: ${String(em)}em)`;
  const subscribe = useCallback(
    (changed: () => void) => {
      const held = window.matchMedia(query);
      held.addEventListener("change", changed);
      return () => {
        held.removeEventListener("change", changed);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
