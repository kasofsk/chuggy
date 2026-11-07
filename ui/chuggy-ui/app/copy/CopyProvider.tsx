/**
 * The catalog under a React tree: `CopyProvider` holds the bundle a page is
 * drawn in, the base language's unless it is handed a layered one, and
 * `useCopyText` formats a descriptor in it.
 */

import type { FluentBundle } from "@fluent/bundle";
import {
  LocalizationProvider,
  ReactLocalization,
  useLocalization,
} from "@fluent/react";
import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";

import type { Copy, CopyText } from "../core/copy.ts";
import { copyCatalogEn, copyLocale } from "./catalog.ts";
import { copyBundleOf } from "./copyBundle.ts";

/** A message the catalog cannot format is a catalog the gate let through, so
 * it is thrown rather than drawn as its id. */
function copyReported(error: Error): never {
  throw error;
}

const copyLocalizationEn = new ReactLocalization(
  [copyBundleOf(copyLocale, copyCatalogEn)],
  null,
  copyReported,
);

export function CopyProvider(props: {
  readonly children: ReactNode;
  readonly bundle?: FluentBundle | undefined;
}): ReactNode {
  const { bundle } = props;
  const l10n = useMemo(
    () =>
      bundle === undefined
        ? copyLocalizationEn
        : new ReactLocalization([bundle], null, copyReported),
    [bundle],
  );
  return (
    <LocalizationProvider l10n={l10n}>{props.children}</LocalizationProvider>
  );
}

/** The same function for as long as the bundle is, so a memo it is a
 * dependency of holds. */
export function useCopyText(): CopyText {
  const { l10n } = useLocalization();
  return useCallback(
    (copy: Copy) => l10n.getString(copy.id, "args" in copy ? copy.args : null),
    [l10n],
  );
}
