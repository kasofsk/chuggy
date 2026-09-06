/** jsdom has no ResizeObserver; Radix's popper asks for one on mount. */

import { vi } from "vitest";

export function resizeObserverStubbed(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}
