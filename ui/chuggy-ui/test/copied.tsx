/**
 * A suite's render, under the catalog a reader is drawn in. The suites find
 * what is drawn by its English, so they render through the base language's
 * catalog itself rather than through ids or a copy of its words, unless a
 * suite hands it another wording.
 */

import { render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

import { copyLocale } from "../app/copy/catalog.ts";
import { CopyProvider } from "../app/copy/CopyProvider.tsx";

export function renderCopied(
  ui: ReactNode,
  {
    wording = copyLocale,
    ...options
  }: Omit<RenderOptions, "queries"> & { readonly wording?: string } = {},
): RenderResult {
  const Inner = options.wrapper;
  return render(ui, {
    ...options,
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <CopyProvider wording={wording}>
        {Inner === undefined ? children : <Inner>{children}</Inner>}
      </CopyProvider>
    ),
  });
}
