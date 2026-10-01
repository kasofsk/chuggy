/**
 * Where the forge sends a person back after they install an app.
 *
 * It is outside the partition routes because the forge redirects to one fixed
 * address and knows nothing about a project; the transaction this tab stored
 * before sending them away is what says which project and where they were.
 * That transaction is taken once, on the first render, and a matching install
 * goes on to the authorization that proves which accounts are theirs.
 */

import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
import { transientStore } from "./ports.ts";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while it reads where to send the person. */
export const forgeSetupConnecting = "Connecting";

/** What this page says where this deployment cannot redeem an authorization. */
export const forgeSetupNotConfigured = "Not configured";

function ForgeSetupAuthorize(props: {
  readonly decision: Extract<ForgeSetupDecision, { decision: "Authorize" }>;
}): ReactNode {
  const ports = useApiPorts();
  const [stopped, setStopped] = useState<string | undefined>(undefined);
  const started = useRef(false);
  const transaction = props.decision.transaction;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const apps = await apiForgeApps(ports);
      const client =
        apps.outcome === "Ok" ? apps.value.authorization : undefined;
      if (client === undefined) {
        setStopped(
          apps.outcome === "Ok" ? forgeSetupNotConfigured : "Unavailable",
        );
        return;
      }
      await forgeAuthorizeRedirect(client, {
        tenant: transaction.tenant,
        project: transaction.project,
        returnPath: transaction.returnPath,
      });
    })();
  }, [ports, transaction]);
  if (stopped === undefined)
    return (
      <Notice tone="info" inline role="status" detail={forgeSetupConnecting} />
    );
  return (
    <>
      <Notice tone="danger" inline detail={stopped} />
      <a href={transaction.returnPath}>Repositories</a>
    </>
  );
}

function ForgeSetupAnswer(props: {
  readonly decision: ForgeSetupDecision;
}): ReactNode {
  const decision = props.decision;
  switch (decision.decision) {
    case "Authorize":
      return <ForgeSetupAuthorize decision={decision} />;
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
  const query = useSearch({ from: forgeSetupRoutePath });
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
