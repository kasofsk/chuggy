/** An observer the case reports through, as a browser reports a header
 * leaving the view. */

import { vi } from "vitest";

export function intersectionObserverStubbed(): (intersecting: boolean) => void {
  let report: (intersecting: boolean) => void = () => undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(told: (entries: { isIntersecting: boolean }[]) => void) {
        report = (intersecting) => {
          told([{ isIntersecting: intersecting }]);
        };
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  return (intersecting) => {
    report(intersecting);
  };
}
