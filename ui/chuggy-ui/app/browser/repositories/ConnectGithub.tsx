/**
 * Connecting GitHub accounts: the person authorizes the portal app at the
 * forge, and the accounts it proves they own are what this tenant claims. It is
 * offered only where this deployment answers a client to authorize, and where
 * it answers none the button says why beside itself. A page whose one way
 * forward it is draws it as its primary action.
 *
 * A PAGE ASKED TO PRESS IT PRESSES IT ONCE, AND ONLY FOR A SOLE ADMINISTRATOR.
 * Redeeming the authorization claims every account the person owns at the
 * forge, and the forge skips its own page for an app already authorized, so
 * for anyone sharing the workspace with another administrator, or whose
 * people list did not answer whole, the press is the consent and the button
 * waits for it.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ForgeAuthorizationClientResponse } from "../../../../../src/contract/responses.ts";
import { tenantSoleAdministrator } from "../../core/tenantPeople.ts";
import { forgeAppsQuery, tenantPeopleQuery } from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { forgeAuthorizeRedirect } from "../forgeAuthorizeRedirect.ts";
import { forgeSetupNotConfigured } from "../ForgeSetupPage.tsx";
import { pageRestoredHeard, redirect } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import type { ButtonVariant } from "../ui/Button.tsx";

/** Whether the press begins by itself: asked, and the reader the workspace's
 * one administrator by a people list answered whole. */
function useConnectGithubPressed(tenant: string, asked: boolean): boolean {
  const people = usePanelState({
    ...tenantPeopleQuery(tenant),
    enabled: asked,
  });
  return (
    asked && people.state === "Ready" && tenantSoleAdministrator(people.value)
  );
}

export function ConnectGithub(props: {
  readonly tenant: string;
  readonly returnPath: string;
  readonly variant?: ButtonVariant | undefined;
  /** The page was asked to press it, its address no longer saying so. */
  readonly asked?: boolean | undefined;
}): ReactNode {
  const text = useCopyText();
  const tenant = props.tenant;
  const state = usePanelState(forgeAppsQuery(tenant));
  const [leaving, setLeaving] = useState(false);
  const pressed = useConnectGithubPressed(tenant, props.asked === true);
  const pressedOnce = useRef(false);
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
  const press = (held: ForgeAuthorizationClientResponse): void => {
    setLeaving(true);
    void forgeAuthorizeRedirect(
      held,
      { tenant, returnPath: props.returnPath, installs: [] },
      redirect,
    );
  };
  useEffect(() => {
    if (!pressed || client === undefined || pressedOnce.current) return;
    pressedOnce.current = true;
    press(client);
  });
  return (
    <span className="flex items-center gap-2">
      <Button
        variant={props.variant}
        size="sm"
        disabled={client === undefined || leaving}
        busy={leaving}
        onClick={() => {
          if (client !== undefined) press(client);
        }}
      >
        {text({ id: "repositories-connect-github" })}
      </Button>
      {state.state === "Ready" && client === undefined ? (
        <span className="text-xs text-ink-3">
          {text(forgeSetupNotConfigured)}
        </span>
      ) : null}
    </span>
  );
}
