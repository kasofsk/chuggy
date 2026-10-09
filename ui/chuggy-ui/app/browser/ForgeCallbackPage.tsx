/**
 * Where the forge returns a person's authorization of the portal app, outside
 * the partition because the stored transaction names the tenant. The
 * transaction is taken, and the code posted once and cleared from the address.
 * An answer that leaves an app to be installed sends the person on to that
 * app's install, once for each app, in this address's place so going back
 * does not land here. Any other answer puts them back where they pressed, with
 * the word it came to. A return this tab did not start has nowhere to go back
 * to, so it stays.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ForgeAppName } from "../../../../src/contract/rosters.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeApps, apiForgeAuthorization } from "../core/apiRoutes.ts";
import {
  forgeAuthorizationDeclined,
  forgeAuthorizationInstall,
  forgeAuthorizationWord,
  forgeAuthorizeTake,
  forgeCallbackDecision,
  forgeCallbackQueryOf,
  forgeCallbackRedirectUri,
  forgeCallbackRoutePath,
} from "../core/forgeAuthorization.ts";
import type { ForgeCallbackDecision } from "../core/forgeAuthorization.ts";
import {
  forgeInstallBegin,
  forgeInstallOffered,
  forgeInstallState,
  forgeInstallUrl,
} from "../core/forgeInstallation.ts";
import { forgePressSentOn } from "../core/forgePress.ts";
import type { ForgePress } from "../core/forgePress.ts";
import { forgeSetupUnexpected } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import {
  currentOrigin,
  drawBytes,
  replaceLocation,
  transientStore,
} from "./ports.ts";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while the code is being redeemed. */
export const forgeCallbackConnecting = "Connecting";

/** Whether the person was sent on to the app's install, which they are not
 * where this deployment does not offer it. */
async function forgeCallbackSentOn(
  ports: ApiPorts,
  press: ForgePress,
  app: ForgeAppName,
): Promise<boolean> {
  const apps = await apiForgeApps(ports);
  const held =
    apps.outcome === "Ok" ? forgeInstallOffered(apps.value, app) : undefined;
  if (held === undefined) return false;
  const state = forgeInstallState(drawBytes);
  forgeInstallBegin(transientStore, {
    ...forgePressSentOn(press, app),
    state,
  });
  replaceLocation(forgeInstallUrl(held.installUrl, state));
  return true;
}

async function forgeCallbackAnswer(
  ports: ApiPorts,
  navigate: UseNavigateResult<string>,
  decision: ForgeCallbackDecision,
): Promise<void> {
  if (decision.decision === "Declined") {
    await forgeReturnNavigate(
      navigate,
      decision.transaction,
      forgeAuthorizationDeclined,
    );
    return;
  }
  void navigate({
    to: forgeCallbackRoutePath,
    search: forgeCallbackQueryOf({}),
    replace: true,
  });
  if (decision.decision === "Unexpected") return;
  const { code, transaction } = decision;
  const answered = await apiForgeAuthorization(ports, transaction.tenant, {
    forge: "github",
    code,
    redirectUri: forgeCallbackRedirectUri(currentOrigin()),
    codeVerifier: transaction.verifier,
  });
  const app = forgeAuthorizationInstall(answered, transaction.installs);
  if (app !== undefined && (await forgeCallbackSentOn(ports, transaction, app)))
    return;
  await forgeReturnNavigate(
    navigate,
    transaction,
    forgeAuthorizationWord(answered),
  );
}

function ForgeCallbackDrawn(props: {
  readonly decision: ForgeCallbackDecision;
}): ReactNode {
  switch (props.decision.decision) {
    case "Redeem":
      return (
        <Notice
          tone="info"
          inline
          role="status"
          detail={forgeCallbackConnecting}
        />
      );
    case "Declined":
      return null;
    case "Unexpected":
      return (
        <>
          <Notice tone="danger" inline detail={forgeSetupUnexpected} />
          <Link to="/">Home</Link>
        </>
      );
  }
}

export function ForgeCallbackPage(): ReactNode {
  const query = useSearch({ from: forgeCallbackRoutePath });
  const navigate = useNavigate();
  const ports = useApiPorts();
  const [decision] = useState<ForgeCallbackDecision>(() =>
    forgeCallbackDecision(query, forgeAuthorizeTake(transientStore)),
  );
  const answered = useRef(false);
  useEffect(() => {
    if (answered.current) return;
    answered.current = true;
    void forgeCallbackAnswer(ports, navigate, decision);
  }, [ports, navigate, decision]);
  return (
    <div className="grid min-h-dvh content-start gap-4 p-4">
      <main className="grid gap-3">
        <h1 className="text-md font-strong text-ink-1">GitHub</h1>
        <ForgeCallbackDrawn decision={decision} />
      </main>
      <Footer />
    </div>
  );
}
