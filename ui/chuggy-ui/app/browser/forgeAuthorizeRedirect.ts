/** Sending a person to the forge to authorize the portal app, from any page that starts it. */

import type { ForgeAuthorizationClientResponse } from "../../../../src/contract/responses.ts";
import { forgeAuthorizeBegin } from "../core/forgeAuthorization.ts";
import type { ForgePress } from "../core/forgePress.ts";
import {
  currentOrigin,
  digest,
  drawBytes,
  redirect,
  transientStore,
} from "./ports.ts";

/** Stores this tab's transaction and sends the person to the forge. */
export async function forgeAuthorizeRedirect(
  client: ForgeAuthorizationClientResponse,
  press: ForgePress,
): Promise<void> {
  redirect(
    await forgeAuthorizeBegin(
      { drawBytes, digest, transient: transientStore },
      client,
      currentOrigin(),
      press,
    ),
  );
}
