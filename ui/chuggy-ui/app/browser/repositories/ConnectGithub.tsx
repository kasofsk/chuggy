/**
 * Connecting GitHub accounts: the person authorizes the portal app at the
 * forge, and the accounts it proves they own are what this tenant claims. It is
 * offered only where this deployment answers a client to authorize.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiForgeApps } from "../../core/apiRoutes.ts";
import { usePanelResource } from "../api.ts";
import { forgeAuthorizeRedirect } from "../forgeAuthorizeRedirect.ts";
import { Button } from "../ui/Button.tsx";
import { forgeAppsResource } from "./ConnectAccount.tsx";

export function ConnectGithub(props: {
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
  const [leaving, setLeaving] = useState(false);
  const client =
    state.state === "Ready" ? state.value.authorization : undefined;
  return (
    <Button
      size="sm"
      disabled={client === undefined || leaving}
      busy={leaving}
      onClick={() => {
        if (client === undefined) return;
        setLeaving(true);
        void forgeAuthorizeRedirect(client, {
          tenant: partition.tenant,
          project: partition.project,
          returnPath: props.returnPath,
        });
      }}
    >
      Connect GitHub
    </Button>
  );
}
