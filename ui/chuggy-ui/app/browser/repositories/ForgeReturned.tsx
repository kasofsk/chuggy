/**
 * The word a person came back from the forge with, drawn in one line on the
 * page they left from. Taking it is what clears it, so every page a press
 * returns to takes it: a word left held would be drawn by whichever of them
 * the person opened next, about a press that page never saw.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { forgeReturnTake } from "../../core/forgeReturn.ts";
import type {
  ForgeReturnStanding,
  ForgeReturnWord,
} from "../../core/forgeReturn.ts";
import { transientStore } from "../ports.ts";
import { Notice } from "../ui/Notice.tsx";
import type { NoticeTone } from "../ui/Notice.tsx";

function forgeReturnedTone(standing: ForgeReturnStanding): NoticeTone {
  switch (standing) {
    case "Failed":
      return "danger";
    case "Unfinished":
    case "Uninstalled":
      return "parked";
  }
}

/** The word held for the tenant, taken as the page is first drawn. */
export function useForgeReturned(tenant: string): ForgeReturnWord | undefined {
  const [returned] = useState(() => forgeReturnTake(transientStore, tenant));
  return returned;
}

export function ForgeReturned(props: {
  readonly word: ForgeReturnWord | undefined;
}): ReactNode {
  const word = props.word;
  if (word === undefined) return null;
  return (
    <Notice
      tone={forgeReturnedTone(word.standing)}
      inline
      detail={word.status}
    />
  );
}
