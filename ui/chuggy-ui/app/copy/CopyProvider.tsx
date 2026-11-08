/**
 * The catalog under a React tree: `CopyProvider` holds the wording a page is
 * drawn in, the base language unless it is handed another, `useCopyText`
 * formats a descriptor in it, and `useCopyWording` chooses another, drawn at
 * once.
 */

import {
  LocalizationProvider,
  ReactLocalization,
  useLocalization,
} from "@fluent/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { Copy, CopyText } from "../core/copy.ts";
import { copyCatalogEn, copyLocale } from "./catalog.ts";
import { copyBundleOf } from "./copyBundle.ts";
import { copyWordingBundle, copyWordingsOf } from "./copyWordings.ts";
import type { CopyVernaculars } from "./copyWordings.ts";
import { copyVernaculars } from "./generated/vernaculars.ts";

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

export interface CopyWording {
  readonly wording: string;
  readonly wordings: readonly string[];
  readonly choose: (wording: string) => void;
}

const CopyWordingContext = createContext<CopyWording | undefined>(undefined);

export function CopyProvider(props: {
  readonly children: ReactNode;
  /** The wording drawn first, which must be one the catalog holds. */
  readonly wording?: string;
  /** Told of each wording chosen, as it is drawn. */
  readonly onWording?: (wording: string) => void;
  readonly vernaculars?: CopyVernaculars;
}): ReactNode {
  const vernaculars = props.vernaculars ?? copyVernaculars;
  const { onWording } = props;
  const [wording, setWording] = useState(props.wording ?? copyLocale);
  const l10n = useMemo(
    () =>
      wording === copyLocale
        ? copyLocalizationEn
        : new ReactLocalization(
            [copyWordingBundle(wording, vernaculars)],
            null,
            copyReported,
          ),
    [wording, vernaculars],
  );
  const held = useMemo(
    (): CopyWording => ({
      wording,
      wordings: copyWordingsOf(vernaculars),
      choose: (chosen) => {
        setWording(chosen);
        onWording?.(chosen);
      },
    }),
    [wording, vernaculars, onWording],
  );
  return (
    <CopyWordingContext.Provider value={held}>
      <LocalizationProvider l10n={l10n}>{props.children}</LocalizationProvider>
    </CopyWordingContext.Provider>
  );
}

export function useCopyWording(): CopyWording {
  const held = useContext(CopyWordingContext);
  if (held === undefined)
    throw new Error("a wording is chosen only under a CopyProvider");
  return held;
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
