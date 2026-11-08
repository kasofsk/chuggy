/**
 * Where the forge sends a person back after they install an app.
 *
 * It is outside the partition routes because the forge redirects to one fixed
 * address and knows nothing about a tenant; the transaction this tab stored
 * before sending them away is what says which tenant and where they were.
 * That transaction is taken once, on the first render, and a matching install
 * goes on to the authorization that proves which accounts are theirs, in this
 * address's place: a landing gone back to would take the transaction of
 * whichever install the press had gone on to since. Any other return the tab
 * started puts the person back where they were, with its word.
 *
 * An update this tab cannot match is drawn as a return and asks nothing of
 * the API: one line, and the way on, which is the page this tab left by where
 * it stored one and Home where it did not.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeApps } from "../core/apiRoutes.ts";
import type { Copy } from "../core/copy.ts";
import { forgeInstallTake } from "../core/forgeInstallation.ts";
import {
  forgeSetupDecision,
  forgeSetupRequested,
  forgeSetupRoutePath,
  forgeSetupUnexpected,
  forgeSetupUpdated,
} from "../core/forgeSetup.ts";
import type { ForgeSetupDecision } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { forgeAuthorizeRedirect } from "./forgeAuthorizeRedirect.ts";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import { replaceLocation, transientStore } from "./ports.ts";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

/** What this page says while it reads where to send the person. */
export const forgeSetupConnecting: Copy = { id: "repositories-connecting" };

/** What this console says where this deployment cannot redeem an authorization. */
export const forgeSetupNotConfigured: Copy = {
  id: "repositories-not-configured",
};

async function forgeSetupAnswer(
  ports: ApiPorts,
  navigate: UseNavigateResult<string>,
  decision: ForgeSetupDecision,
): Promise<void> {
  if (decision.decision === "Unexpected" || decision.decision === "Updated")
    return;
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
      status: apps.outcome === "Ok" ? "NotConfigured" : "Unavailable",
    });
    return;
  }
  await forgeAuthorizeRedirect(
    client,
    {
      tenant: transaction.tenant,
      returnPath: transaction.returnPath,
      installs: transaction.installs,
    },
    replaceLocation,
  );
}

function ForgeSetupDrawn(props: {
  readonly decision: ForgeSetupDecision;
  readonly navigate: UseNavigateResult<string>;
}): ReactNode {
  const text = useCopyText();
  const decision = props.decision;
  switch (decision.decision) {
    case "Authorize":
      return (
        <Notice
          tone="info"
          inline
          role="status"
          detail={text(forgeSetupConnecting)}
        />
      );
    case "Requested":
      return null;
    case "Updated": {
      const press = decision.press;
      return (
        <>
          <Notice tone="info" inline detail={text(forgeSetupUpdated)} />
          {press === undefined ? (
            <Link to="/">{text({ id: "repositories-home" })}</Link>
          ) : (
            <div className="flex">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void forgeReturnNavigate(props.navigate, press, undefined);
                }}
              >
                {text({ id: "repositories-continue" })}
              </Button>
            </div>
          )}
        </>
      );
    }
    case "Unexpected":
      return (
        <>
          <Notice tone="danger" inline detail={text(forgeSetupUnexpected)} />
          <Link to="/">{text({ id: "repositories-home" })}</Link>
        </>
      );
  }
}

export function ForgeSetupPage(): ReactNode {
  const text = useCopyText();
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
        <h1 className="text-md font-strong text-ink-1">
          {text({ id: "repositories-setup-title" })}
        </h1>
        <ForgeSetupDrawn decision={decision} navigate={navigate} />
      </main>
      <Footer />
    </div>
  );
}
