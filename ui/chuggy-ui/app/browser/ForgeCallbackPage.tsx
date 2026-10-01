/**
 * Where the forge returns a person's authorization of the portal app, outside
 * the partition because the stored transaction names the tenant. The
 * transaction is taken, the code posted once and cleared from the address, and
 * the person put back where they pressed Connect GitHub with the word it came
 * to. A return this tab did not start has nowhere to go back to, so it stays.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeAuthorization } from "../core/apiRoutes.ts";
import {
  forgeAuthorizationDeclined,
  forgeAuthorizationWord,
  forgeAuthorizeTake,
  forgeCallbackDecision,
  forgeCallbackQueryOf,
  forgeCallbackRedirectUri,
  forgeCallbackRoutePath,
} from "../core/forgeAuthorization.ts";
import type { ForgeCallbackDecision } from "../core/forgeAuthorization.ts";
import { forgeSetupUnexpected } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import { currentOrigin, transientStore } from "./ports.ts";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while the code is being redeemed. */
export const forgeCallbackConnecting = "Connecting";

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
