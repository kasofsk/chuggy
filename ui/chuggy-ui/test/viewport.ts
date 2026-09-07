/**
 * The width a case is reading at. The document a suite runs against answers no
 * media query at all, and the shell asks two of them — the rail is a drawer or
 * a column, the details are the middle or an aside — so a case that mounts the
 * shell states the width instead of inheriting one.
 */

import { vi } from "vitest";

const viewportAsked = /min-width:\s*([0-9.]+)em/u;

export function viewportAtEm(em: number): void {
  vi.stubGlobal("matchMedia", (query: string) => {
    const asked = viewportAsked.exec(query);
    return {
      matches: asked !== null && em >= Number(asked[1]),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}
