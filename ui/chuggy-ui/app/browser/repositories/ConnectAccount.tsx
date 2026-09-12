/**
 * Connecting a forge account: the two apps this deployment holds a key for,
 * each drawn as the address it is installed from.
 *
 * The state is minted once per opened dialog and written to the transaction
 * store as the link is followed, so what comes back to the setup landing
 * carries a state only this tab can match.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ForgeAppName } from "../../../../../src/contract/rosters.ts";
import { apiForgeApps } from "../../core/apiRoutes.ts";
import {
  forgeAppLabel,
  forgeInstallBegin,
  forgeInstallState,
  forgeInstallUrl,
} from "../../core/forgeInstallation.ts";
import { usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes, transientStore } from "../ports.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";

/** No frame names this read, so the partition's own refetch is what reaches it. */
export const forgeAppsResource = "forge-apps";

/** One state per app, drawn once so the address a link carries never changes
 * under the reader between drawing it and following it. */
type ForgeInstallStates = Readonly<Record<ForgeAppName, string>>;

function ConnectAppLinks(props: {
  readonly partition: PartitionIdentity;
  readonly returnPath: string;
}): ReactNode {
  const partition = props.partition;
  const state = usePanelResource(
    partition,
    "Project",
    forgeAppsResource,
    (ports) => apiForgeApps(ports),
  );
  const [states] = useState<ForgeInstallStates>(() => ({
    portal: forgeInstallState(drawBytes),
    worker: forgeInstallState(drawBytes),
  }));
  return (
    <>
      <PanelUnready state={state} />
      {state.state === "Ready"
        ? state.value.apps.map((app) => (
            <a
              key={app.app}
              href={forgeInstallUrl(app.installUrl, states[app.app])}
              className={buttonLookClassName({ size: "sm" })}
              onClick={() => {
                forgeInstallBegin(transientStore, {
                  state: states[app.app],
                  app: app.app,
                  tenant: partition.tenant,
                  project: partition.project,
                  returnPath: props.returnPath,
                });
              }}
            >
              {forgeAppLabel(app.app)}
            </a>
          ))
        : null}
    </>
  );
}

export function ConnectAccount(props: {
  readonly partition: PartitionIdentity;
  readonly returnPath: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      title="Connect"
      trigger="Connect"
      open={open}
      onOpenChange={setOpen}
    >
      <ConnectAppLinks
        partition={props.partition}
        returnPath={props.returnPath}
      />
    </Dialog>
  );
}
