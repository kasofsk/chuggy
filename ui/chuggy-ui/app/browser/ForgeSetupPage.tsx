/**
 * Where the forge sends a person back after they install an app.
 *
 * It is outside the partition routes because the forge redirects to one fixed
 * address and knows nothing about a tenant; the transaction this tab stored
 * before sending them away is what says which tenant and where they were.
 * That transaction is taken once, on the first render, and a matching install
 * goes on to the authorization that proves which accounts are theirs. Any other
 * return the tab started puts the person back where they were, with its word.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeApps } from "../core/apiRoutes.ts";
import { forgeInstallTake } from "../core/forgeInstallation.ts";
import {
  forgeSetupDecision,
  forgeSetupRequested,
  forgeSetupRoutePath,
  forgeSetupUnexpected,
} from "../core/forgeSetup.ts";
import type { ForgeSetupDecision } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { forgeAuthorizeRedirect } from "./forgeAuthorizeRedirect.ts";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import { transientStore } from "./ports.ts";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while it reads where to send the person. */
export const forgeSetupConnecting = "Connecting";

/** What this console says where this deployment cannot redeem an authorization. */
export const forgeSetupNotConfigured = "Not configured";

async function forgeSetupAnswer(
  ports: ApiPorts,
  navigate: UseNavigateResult<string>,
  decision: ForgeSetupDecision,
): Promise<void> {
  if (decision.decision === "Unexpected") return;
  const transaction = decision.transaction;
  if (decision.decision === "Requested") {
    await forgeReturnNavigate(navigate, transaction, forgeSetupRequested);
    return;
  }
  const apps = await apiForgeApps(ports);
  const client = apps.outcome === "Ok" ? apps.value.authorization : undefined;
  if (client === undefined) {
    await forgeReturnNavigate(navigate, transaction, {
      standing: "Failed",
      status: apps.outcome === "Ok" ? forgeSetupNotConfigured : "Unavailable",
    });
    return;
  }
  await forgeAuthorizeRedirect(client, {
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
  });
}

function ForgeSetupDrawn(props: {
  readonly decision: ForgeSetupDecision;
}): ReactNode {
  switch (props.decision.decision) {
    case "Authorize":
      return (
        <Notice
          tone="info"
          inline
          role="status"
          detail={forgeSetupConnecting}
        />
      );
    case "Requested":
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

export function ForgeSetupPage(): ReactNode {
  const query = useSearch({ from: forgeSetupRoutePath });
  const navigate = useNavigate();
  const ports = useApiPorts();
  const [decision] = useState<ForgeSetupDecision>(() =>
    forgeSetupDecision(query, forgeInstallTake(transientStore)),
  );
  const answered = useRef(false);
  useEffect(() => {
    if (answered.current) return;
    answered.current = true;
    void forgeSetupAnswer(ports, navigate, decision);
  }, [ports, navigate, decision]);
  return (
    <div className="grid min-h-dvh content-start gap-4 p-4">
      <main className="grid gap-3">
        <h1 className="text-md font-strong text-ink-1">Setup</h1>
        <ForgeSetupDrawn decision={decision} />
      </main>
      <Footer />
    </div>
  );
}
