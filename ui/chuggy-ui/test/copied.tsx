/**
 * A suite's render, under the catalog a reader is drawn in. The suites find
 * what is drawn by its English, so they render through the base language's
 * catalog itself rather than through ids or a copy of its words.
 */

import { render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

import { CopyProvider } from "../app/copy/CopyProvider.tsx";

export function renderCopied(
  ui: ReactNode,
  options: Omit<RenderOptions, "queries"> = {},
): RenderResult {
  const Inner = options.wrapper;
  return render(ui, {
    ...options,
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <CopyProvider>
        {Inner === undefined ? children : <Inner>{children}</Inner>}
      </CopyProvider>
    ),
  });
}
