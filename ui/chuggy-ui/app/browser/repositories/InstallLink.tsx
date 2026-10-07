/**
 * Installing one of this deployment's apps, drawn as the address it is
 * installed from. Nothing is drawn until the deployment has answered, where it
 * holds no key for the app named, or where it answers no client to authorize:
 * the setup landing claims an install only through that authorization, so
 * without one the person would install the app and land on Not configured.
 *
 * The state is minted once per drawn link and written to the transaction store
 * as the link is followed, so what comes back to the setup landing carries a
 * state only this tab can match.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { ForgeAppName } from "../../../../../src/contract/rosters.ts";
import { apiForgeApps } from "../../core/apiRoutes.ts";
import {
  forgeInstallBegin,
  forgeInstallLabel,
  forgeInstallState,
  forgeInstallUrl,
} from "../../core/forgeInstallation.ts";
import { usePanelTenantResource } from "../api.ts";
import { drawBytes, transientStore } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";

/** No frame names this read; what reaches it is whichever refresh the scope
 * it is read under follows. */
export const forgeAppsResource = "forge-apps";

export function InstallLink(props: {
  readonly tenant: string;
  readonly returnPath: string;
  readonly app: ForgeAppName;
  /** What the link says in place of the app's install label. */
  readonly label?: string;
}): ReactNode {
  const tenant = props.tenant;
  const state = usePanelTenantResource(tenant, forgeAppsResource, (ports) =>
    apiForgeApps(ports),
  );
  const [installState] = useState(() => forgeInstallState(drawBytes));
  const held =
    state.state === "Ready" && state.value.authorization !== undefined
      ? state.value.apps.find((app) => app.app === props.app)
      : undefined;
  if (held === undefined) return null;
  return (
    <a
      href={forgeInstallUrl(held.installUrl, installState)}
      className={buttonLookClassName({ size: "sm" })}
      onClick={() => {
        forgeInstallBegin(transientStore, {
          state: installState,
          app: props.app,
          tenant,
          returnPath: props.returnPath,
        });
      }}
    >
      {props.label ?? forgeInstallLabel(props.app)}
    </a>
  );
}
