/** Putting a person back on the page they left for the forge from, with the word their return came to. */

import type { UseNavigateResult } from "@tanstack/react-router";

import type { ForgeAuthorizeTarget } from "../core/forgeAuthorization.ts";
import { forgeReturnHold } from "../core/forgeReturn.ts";
import type { ForgeReturnWord } from "../core/forgeReturn.ts";
import { transientStore } from "./ports.ts";

/** The page left replaces this address, so going back does not land here again. */
export function forgeReturnNavigate(
  navigate: UseNavigateResult<string>,
  target: ForgeAuthorizeTarget,
  word: ForgeReturnWord | undefined,
): Promise<void> {
  if (word !== undefined) forgeReturnHold(transientStore, target, word);
  return navigate({ href: target.returnPath, replace: true });
}
