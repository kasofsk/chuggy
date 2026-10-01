/**
 * Installing one of this deployment's apps, drawn as the address it is
 * installed from. Nothing is drawn until the deployment has answered, or where
 * it holds no key for the app named.
 *
 * The state is minted once per drawn link and written to the transaction store
 * as the link is followed, so what comes back to the setup landing carries a
 * state only this tab can match.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ForgeAppName } from "../../../../../src/contract/rosters.ts";
import { apiForgeApps } from "../../core/apiRoutes.ts";
import {
  forgeInstallBegin,
  forgeInstallLabel,
  forgeInstallState,
  forgeInstallUrl,
} from "../../core/forgeInstallation.ts";
import { usePanelResource } from "../api.ts";
import { drawBytes, transientStore } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";

/** No frame names this read, so the partition's own refetch is what reaches it. */
export const forgeAppsResource = "forge-apps";

export function InstallLink(props: {
  readonly partition: PartitionIdentity;
  readonly returnPath: string;
  readonly app: ForgeAppName;
  /** What the link says in place of the app's install label. */
  readonly label?: string;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelResource(
    partition,
    "Project",
    forgeAppsResource,
    (ports) => apiForgeApps(ports),
  );
  const [installState] = useState(() => forgeInstallState(drawBytes));
  const held =
    state.state === "Ready"
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
          tenant: partition.tenant,
          project: partition.project,
          returnPath: props.returnPath,
        });
      }}
    >
      {props.label ?? forgeInstallLabel(props.app)}
    </a>
  );
}
