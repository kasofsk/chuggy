/**
 * Where the forge returns a person's authorization of the portal app, outside
 * the partition because the stored transaction names the tenant. The
 * transaction is taken, the code posted once and then cleared from the address.
 *
 * Every install offered here comes back through the setup landing to this page,
 * so a person missing an app installs it and returns connected. One who proved
 * no account is offered the portal app's install.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { apiForgeAuthorization } from "../core/apiRoutes.ts";
import {
  forgeAuthorizationOutcome,
  forgeAuthorizeTake,
  forgeCallbackDecision,
  forgeCallbackQueryOf,
  forgeCallbackRedirectUri,
  forgeCallbackRoutePath,
  forgePortalInstallOffered,
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
import { ConnectGithub } from "./repositories/ConnectGithub.tsx";
import { InstallLink } from "./repositories/InstallLink.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Pill } from "./ui/Pill.tsx";

/** What this page says while the code is being redeemed. */
export const forgeCallbackConnecting = "Connecting";

/** What this page says where the person declined at the forge. */
export const forgeCallbackDeclined = "Declined";

/** What this page says where the authorization reached no installation of the portal app. */
export const forgeCallbackNotInstalled = "Not installed";

function ForgeCallbackLines(props: {
  readonly outcome: Extract<
    ForgeAuthorizationOutcome,
    { outcome: "Authorized" }
  >;
  readonly transaction: ForgeAuthorizeTransaction;
}): ReactNode {
  const { outcome, transaction } = props;
  const partition = {
    tenant: transaction.tenant,
    project: transaction.project,
  };
  return (
    <>
      {outcome.lines.length === 0 ? (
        <Notice tone="parked" inline detail={forgeCallbackNotInstalled} />
      ) : (
        <ul className="grid gap-2">
          {outcome.lines.map((line) => (
            <li key={line.account} className="flex items-center gap-2">
              <span className="text-ink-1">{line.account}</span>
              <Pill tone={forgeAccountProofTone(line.proof)}>
                {line.status}
              </Pill>
              {line.install.map((app) => (
                <InstallLink
                  key={app}
                  partition={partition}
                  returnPath={transaction.returnPath}
                  app={app}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
      {outcome.truncated ? (
        <Notice tone="parked" inline detail="Partial" />
      ) : null}
      {forgePortalInstallOffered(outcome.lines) ? (
        <InstallLink
          partition={partition}
          returnPath={transaction.returnPath}
          app="portal"
        />
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
      {outcome.outcome === "Again" ? (
        <ConnectGithub
          partition={{
            tenant: transaction.tenant,
            project: transaction.project,
          }}
          returnPath={transaction.returnPath}
        />
      ) : null}
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
  const navigate = useNavigate();
  const [decision] = useState<ForgeCallbackDecision>(() =>
    forgeCallbackDecision(query, forgeAuthorizeTake(transientStore)),
  );
  useEffect(() => {
    void navigate({
      to: forgeCallbackRoutePath,
      search: forgeCallbackQueryOf({}),
      replace: true,
    });
  }, [navigate]);
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
