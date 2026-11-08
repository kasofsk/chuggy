/**
 * The wording the operator chose, where it is kept, the language the document
 * is said to be in, and the catalog's provider holding all three together.
 *
 * The base language is the absence of a stored word, so a console that has
 * never been told is drawn in it, and a stored word the catalog no longer
 * holds is read as it rather than trusted. The terminal's setup program reads
 * none of this: it is always the base language.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { copyLocale } from "../copy/catalog.ts";
import { CopyProvider } from "../copy/CopyProvider.tsx";
import { copyWordingsOf } from "../copy/copyWordings.ts";
import type { CopyVernaculars } from "../copy/copyWordings.ts";
import { copyVernaculars } from "../copy/generated/vernaculars.ts";
import type { KeyValuePort } from "../core/sessionHolder.ts";

export const wordingStoreKey = "chuggy-wording";

export function wordingRead(
  store: KeyValuePort,
  wordings: readonly string[],
): string {
  const held = store.read(wordingStoreKey);
  return wordings.find((candidate) => candidate === held) ?? copyLocale;
}

export function wordingWrite(store: KeyValuePort, wording: string): void {
  if (wording === copyLocale) store.remove(wordingStoreKey);
  else store.write(wordingStoreKey, wording);
}

export function wordingApply(root: HTMLElement, wording: string): void {
  root.setAttribute("lang", wording);
}

/** The stored wording, drawn first; each chosen one applied before it is
 * stored, so a store a browser refuses still leaves the document saying what
 * it is drawn in. */
export function WordingProvider(props: {
  readonly children: ReactNode;
  readonly store: KeyValuePort;
  readonly root: HTMLElement;
  readonly vernaculars?: CopyVernaculars;
}): ReactNode {
  const { store, root } = props;
  const vernaculars = props.vernaculars ?? copyVernaculars;
  const [wording] = useState(() =>
    wordingRead(store, copyWordingsOf(vernaculars)),
  );
  const chosen = useCallback(
    (picked: string) => {
      wordingApply(root, picked);
      wordingWrite(store, picked);
    },
    [store, root],
  );
  return (
    <CopyProvider
      wording={wording}
      onWording={chosen}
      vernaculars={vernaculars}
    >
      {props.children}
    </CopyProvider>
  );
}
