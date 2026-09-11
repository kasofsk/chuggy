/**
 * Where the forge sends a person back after they install an app.
 *
 * It is outside the partition routes because the forge redirects to one fixed
 * address and knows nothing about a project; the transaction this tab stored
 * before sending them away is what says which project, which app and where they
 * were. That transaction is taken once, on the first render, so a landing
 * opened again claims nothing.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { apiClaimForgeInstallation } from "../core/apiRoutes.ts";
import {
  forgeClaimOutcome,
  forgeInstallTake,
} from "../core/forgeInstallation.ts";
import {
  forgeSetupDecision,
  forgeSetupRequested,
  forgeSetupReturn,
  forgeSetupUnexpected,
} from "../core/forgeSetup.ts";
import type { ForgeSetupDecision } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { transientStore } from "./ports.ts";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while the claim is in flight. */
export const forgeSetupClaiming = "Connecting";

/** What the repositories page is told a landed claim came to. */
export const forgeSetupConnected = "Connected";

function ForgeSetupClaim(props: {
  readonly decision: Extract<ForgeSetupDecision, { decision: "Claim" }>;
}): ReactNode {
  const ports = useApiPorts();
  const navigate = useNavigate();
  const { installationId, transaction } = props.decision;
  useEffect(() => {
    void (async () => {
      const outcome = forgeClaimOutcome(
        await apiClaimForgeInstallation(ports, transaction.tenant, {
          forge: "github",
          app: transaction.app,
          installationId,
        }),
      );
      await navigate({
        href: forgeSetupReturn(
          transaction.returnPath,
          outcome.outcome === "Claimed" ? forgeSetupConnected : outcome.status,
        ),
        replace: true,
      });
    })();
  }, [ports, navigate, transaction, installationId]);
  return (
    <Notice tone="info" inline role="status" detail={forgeSetupClaiming} />
  );
}

function ForgeSetupAnswer(props: {
  readonly decision: ForgeSetupDecision;
}): ReactNode {
  const decision = props.decision;
  switch (decision.decision) {
    case "Claim":
      return <ForgeSetupClaim decision={decision} />;
    case "Requested":
      return (
        <>
          <Notice tone="parked" inline detail={forgeSetupRequested} />
          <a href={decision.transaction.returnPath}>Repositories</a>
        </>
      );
    case "Unexpected":
      return <Notice tone="danger" inline detail={forgeSetupUnexpected} />;
  }
}

export function ForgeSetupPage(): ReactNode {
  const query = useSearch({ from: "/forge/github/setup" });
  const [decision] = useState<ForgeSetupDecision>(() =>
    forgeSetupDecision(query, forgeInstallTake(transientStore)),
  );
  return (
    <div className="grid min-h-dvh content-start gap-4 p-4">
      <main className="grid gap-3">
        <h1 className="text-md font-strong text-ink-1">Setup</h1>
        <ForgeSetupAnswer decision={decision} />
      </main>
      <Footer />
    </div>
  );
}
