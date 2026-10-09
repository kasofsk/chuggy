/**
 * Connecting GitHub accounts: the person authorizes the portal app at the
 * forge, and the accounts it proves they own are what this tenant claims. It is
 * offered only where this deployment answers a client to authorize, and where
 * it answers none the button says why beside itself. A page whose one way
 * forward it is draws it as its primary action.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { apiForgeApps } from "../../core/apiRoutes.ts";
import { usePanelTenantResource } from "../api.ts";
import { forgeAuthorizeRedirect } from "../forgeAuthorizeRedirect.ts";
import { forgeSetupNotConfigured } from "../ForgeSetupPage.tsx";
import { pageRestoredHeard, redirect } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import type { ButtonVariant } from "../ui/Button.tsx";
import { forgeAppsResource } from "./InstallLink.tsx";

export function ConnectGithub(props: {
  readonly tenant: string;
  readonly returnPath: string;
  readonly variant?: ButtonVariant | undefined;
}): ReactNode {
  const tenant = props.tenant;
  const state = usePanelTenantResource(tenant, forgeAppsResource, (ports) =>
    apiForgeApps(ports),
  );
  const [leaving, setLeaving] = useState(false);
  /** A page the browser restores as it was left still says it is leaving, and
   * the person who came back to it has nothing else to press. */
  useEffect(
    () =>
      pageRestoredHeard(() => {
        setLeaving(false);
      }),
    [],
  );
  const client =
    state.state === "Ready" ? state.value.authorization : undefined;
  return (
    <span className="flex items-center gap-2">
      <Button
        variant={props.variant}
        size="sm"
        disabled={client === undefined || leaving}
        busy={leaving}
        onClick={() => {
          if (client === undefined) return;
          setLeaving(true);
          void forgeAuthorizeRedirect(
            client,
            { tenant, returnPath: props.returnPath, installs: [] },
            redirect,
          );
        }}
      >
        Connect GitHub
      </Button>
      {state.state === "Ready" && client === undefined ? (
        <span className="text-xs text-ink-3">{forgeSetupNotConfigured}</span>
      ) : null}
    </span>
  );
}
