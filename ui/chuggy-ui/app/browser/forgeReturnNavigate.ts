/** Putting a person back on the page they left for the forge from, with the word their return came to. */

import type { UseNavigateResult } from "@tanstack/react-router";

import type { ForgePress } from "../core/forgePress.ts";
import { forgeReturnHold } from "../core/forgeReturn.ts";
import type { ForgeReturnWord } from "../core/forgeReturn.ts";
import { transientStore } from "./ports.ts";

/** The page left replaces this address, so going back does not land here again. */
export function forgeReturnNavigate(
  navigate: UseNavigateResult<string>,
  press: ForgePress,
  word: ForgeReturnWord | undefined,
): Promise<void> {
  if (word !== undefined) forgeReturnHold(transientStore, press.tenant, word);
  return navigate({ href: press.returnPath, replace: true });
}
