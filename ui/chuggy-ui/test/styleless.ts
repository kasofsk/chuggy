/** The served policy is `style-src 'self'`, so a primitive that appends a
 * sheet passes every other assertion and is refused by the browser. */

import { expect } from "vitest";

export function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
}
