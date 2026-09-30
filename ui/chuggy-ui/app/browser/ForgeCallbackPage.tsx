/**
 * Where the forge returns a person's authorization of the portal app, outside
 * the partition because the stored transaction names the tenant. The
 * transaction is taken and the code posted once, however often the page draws.
 */

import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { apiForgeAuthorization } from "../core/apiRoutes.ts";
import {
  forgeAuthorizationOutcome,
  forgeAuthorizeTake,
  forgeCallbackDecision,
  forgeCallbackRedirectUri,
  forgeCallbackRoutePath,
} from "../core/forgeAuthorization.ts";
import type {
  ForgeAuthorizationOutcome,
  ForgeAuthorizeTransaction,
  ForgeCallbackDecision,
} from "../core/forgeAuthorization.ts";
import { forgeSetupUnexpected } from "../core/forgeSetup.ts";
import { forgeAccountProofTone } from "../core/tones.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { currentOrigin, transientStore } from "./ports.ts";
import { InstallLinks } from "./repositories/ConnectAccount.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";

/** What this page says while the code is being redeemed. */
export const forgeCallbackConnecting = "Connecting";

/** What this page says where the person declined at the forge. */
export const forgeCallbackDeclined = "Declined";

function ForgeCallbackLines(props: {
  readonly outcome: Extract<
    ForgeAuthorizationOutcome,
    { outcome: "Authorized" }
  >;
  readonly transaction: ForgeAuthorizeTransaction;
}): ReactNode {
  const { outcome, transaction } = props;
  if (outcome.lines.length === 0)
    return <Notice tone="parked" inline detail="No account" />;
  return (
    <>
      <ul className="grid gap-2">
        {outcome.lines.map((line) => (
          <li key={line.account} className="flex items-center gap-2">
            <span className="text-ink-1">{line.account}</span>
            <Pill tone={forgeAccountProofTone(line.proof)}>{line.status}</Pill>
            {line.install.length === 0 ? null : (
              <InstallLinks
                partition={{
                  tenant: transaction.tenant,
                  project: transaction.project,
                }}
                returnPath={transaction.returnPath}
                only={line.install}
              />
            )}
          </li>
        ))}
      </ul>
      {outcome.truncated ? (
        <Notice tone="parked" inline detail="Partial" />
      ) : null}
    </>
  );
}

function ForgeCallbackRedeem(props: {
  readonly decision: Extract<ForgeCallbackDecision, { decision: "Redeem" }>;
}): ReactNode {
  const ports = useApiPorts();
  const [outcome, setOutcome] = useState<ForgeAuthorizationOutcome>();
  const sent = useRef(false);
  const { code, transaction } = props.decision;
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void (async () => {
      setOutcome(
        forgeAuthorizationOutcome(
          await apiForgeAuthorization(ports, transaction.tenant, {
            forge: "github",
            code,
            redirectUri: forgeCallbackRedirectUri(currentOrigin()),
            codeVerifier: transaction.verifier,
          }),
        ),
      );
    })();
  }, [ports, code, transaction]);
  if (outcome === undefined)
    return (
      <Notice
        tone="info"
        inline
        role="status"
        detail={forgeCallbackConnecting}
      />
    );
  return (
    <>
      {outcome.outcome === "Authorized" ? (
        <ForgeCallbackLines outcome={outcome} transaction={transaction} />
      ) : (
        <Notice tone="danger" inline detail={outcome.status} />
      )}
      <a href={transaction.returnPath}>Repositories</a>
    </>
  );
}

function ForgeCallbackAnswer(props: {
  readonly decision: ForgeCallbackDecision;
}): ReactNode {
  const decision = props.decision;
  switch (decision.decision) {
    case "Redeem":
      return <ForgeCallbackRedeem decision={decision} />;
    case "Declined":
      return (
        <>
          <Notice tone="parked" inline detail={forgeCallbackDeclined} />
          <a href={decision.transaction.returnPath}>Repositories</a>
        </>
      );
    case "Unexpected":
      return <Notice tone="danger" inline detail={forgeSetupUnexpected} />;
  }
}

export function ForgeCallbackPage(): ReactNode {
  const query = useSearch({ from: forgeCallbackRoutePath });
  const [decision] = useState<ForgeCallbackDecision>(() =>
    forgeCallbackDecision(query, forgeAuthorizeTake(transientStore)),
  );
  return (
    <div className="grid min-h-dvh content-start gap-4 p-4">
      <main className="grid gap-3">
        <h1 className="text-md font-strong text-ink-1">GitHub</h1>
        <ForgeCallbackAnswer decision={decision} />
      </main>
      <Footer />
    </div>
  );
}
