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

import { useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ForgeAuthorizationResponse } from "../../../../src/contract/responses.ts";
import type { ForgeAppName } from "../../../../src/contract/rosters.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeApps, apiForgeAuthorization } from "../core/apiRoutes.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import {
  forgeAuthorizationDeclined,
  forgeAuthorizationInstall,
  forgeAuthorizationRefusal,
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
import { forgeReturnStatusLabel } from "../core/forgeReturn.ts";
import type { ForgePress } from "../core/forgePress.ts";
import { useApiPorts } from "./api.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import {
  ForgeLandingBack,
  ForgeLandingConnecting,
  ForgeLandingUnexpected,
} from "./ForgeSetupPage.tsx";
import {
  currentOrigin,
  drawBytes,
  replaceLocation,
  transientStore,
} from "./ports.ts";

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

/** A return that redeems its code. */
type ForgeCallbackRedeem = Extract<
  ForgeCallbackDecision,
  { readonly decision: "Redeem" }
>;

/** Where a redeemed code sends the person: on to the install it leaves to be
 * made, or back where they pressed with the word it came to. */
async function forgeCallbackRedeemed(
  ports: ApiPorts,
  navigate: UseNavigateResult<string>,
  transaction: ForgePress,
  answered: ForgeAuthorizationResponse,
): Promise<void> {
  const redeemed = { outcome: "Ok", value: answered } as const;
  const app = forgeAuthorizationInstall(redeemed, transaction.installs);
  if (app !== undefined && (await forgeCallbackSentOn(ports, transaction, app)))
    return;
  await forgeReturnNavigate(
    navigate,
    transaction,
    forgeAuthorizationWord(redeemed),
  );
}

/** The code redeemed for the tenant the transaction names, with its verifier,
 * and the person sent on from its answer whether or not this page is still
 * drawn. */
function forgeCallbackRedeemWrite(
  ports: ApiPorts,
  navigate: UseNavigateResult<string>,
): ConsoleWrite<ForgeCallbackRedeem, ForgeAuthorizationResponse> {
  return {
    mutationKey: consoleWriteKey("forge-authorization"),
    write: (_ports, { code, transaction }) =>
      apiForgeAuthorization(ports, transaction.tenant, {
        forge: "github",
        code,
        redirectUri: forgeCallbackRedirectUri(currentOrigin()),
        codeVerifier: transaction.verifier,
      }),
    refusal: (failure) =>
      forgeReturnStatusLabel(forgeAuthorizationRefusal(failure).status),
    landed: (_client, redeemed, redeem) =>
      forgeCallbackRedeemed(ports, navigate, redeem.transaction, redeemed),
    refused: (refused, redeem) => {
      void forgeReturnNavigate(
        navigate,
        redeem.transaction,
        refused.failure === undefined
          ? undefined
          : forgeAuthorizationRefusal(refused.failure),
      );
    },
  };
}

/** What the return answers before any code is redeemed, and the redemption it
 * asks for where it has one. */
function forgeCallbackAnswer(
  navigate: UseNavigateResult<string>,
  decision: ForgeCallbackDecision,
  redeem: (decision: ForgeCallbackRedeem) => void,
): void {
  if (decision.decision === "Declined") {
    void forgeReturnNavigate(
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
  redeem(decision);
}

function ForgeCallbackDrawn(props: {
  readonly decision: ForgeCallbackDecision;
}): ReactNode {
  switch (props.decision.decision) {
    case "Redeem":
      return <ForgeLandingConnecting />;
    case "Declined":
      return <ForgeLandingBack />;
    case "Unexpected":
      return <ForgeLandingUnexpected />;
  }
}

export function ForgeCallbackPage(): ReactNode {
  const query = useSearch({ from: forgeCallbackRoutePath });
  const navigate = useNavigate();
  const ports = useApiPorts();
  const [decision] = useState<ForgeCallbackDecision>(() =>
    forgeCallbackDecision(query, forgeAuthorizeTake(transientStore)),
  );
  const redeeming = useConsoleWrite(forgeCallbackRedeemWrite(ports, navigate), {
    drawn: (refused) => refused.failure !== undefined,
  });
  const redeemingMutate = redeeming.mutate;
  const answered = useRef(false);
  useEffect(() => {
    if (answered.current) return;
    answered.current = true;
    forgeCallbackAnswer(navigate, decision, (redeem) => {
      redeemingMutate(redeem);
    });
  }, [ports, navigate, decision, redeemingMutate]);
  return <ForgeCallbackDrawn decision={decision} />;
}
