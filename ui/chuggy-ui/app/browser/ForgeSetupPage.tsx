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

import { useNavigate, useSearch } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import type { ApiPorts } from "../core/apiRequest.ts";
import { apiForgeApps } from "../core/apiRoutes.ts";
import type { Copy } from "../core/copy.ts";
import { forgeInstallTake } from "../core/forgeInstallation.ts";
import type { ForgePress } from "../core/forgePress.ts";
import {
  forgeSetupDecision,
  forgeSetupRequested,
  forgeSetupRoutePath,
  forgeSetupUnexpected,
  forgeSetupUpdated,
} from "../core/forgeSetup.ts";
import type { ForgeSetupDecision } from "../core/forgeSetup.ts";
import { useApiPorts } from "./api.ts";
import { forgeAuthorizeRedirect } from "./forgeAuthorizeRedirect.ts";
import { forgeReturnNavigate } from "./forgeReturnNavigate.ts";
import { replaceLocation, transientStore } from "./ports.ts";
import { Button, ButtonLink } from "./ui/Button.tsx";
import { CenteredPage } from "./ui/CenteredPage.tsx";

/** What either landing is for while it reads where to send the person. */
const forgeLandingConnectingTitle: Copy = {
  id: "repositories-connecting-title",
};

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

/** A landing waiting on what it asked, or on the navigation it started. */
export function ForgeLandingConnecting(): ReactNode {
  const text = useCopyText();
  return (
    <CenteredPage landmark title={text(forgeLandingConnectingTitle)}>
      <p role="status">{text(forgeSetupConnecting)}</p>
    </CenteredPage>
  );
}

/** A landing this tab cannot place, whose way on is Home. */
export function ForgeLandingUnexpected(): ReactNode {
  const text = useCopyText();
  return (
    <CenteredPage
      landmark
      title={text({ id: "repositories-setup-unexpected-title" })}
      primary={
        <ButtonLink to="/" variant="primary">
          {text({ id: "repositories-home" })}
        </ButtonLink>
      }
    >
      <p>{text(forgeSetupUnexpected)}</p>
      <p>{text({ id: "repositories-setup-unexpected-next" })}</p>
    </CenteredPage>
  );
}

/** A landing that has sent the person back where they were, drawn until the
 * navigation lands. */
export function ForgeLandingBack(): ReactNode {
  const text = useCopyText();
  return <CenteredPage landmark title={text(forgeSetupUpdated)} />;
}

function ForgeSetupUpdatedPage(props: {
  readonly press: ForgePress | undefined;
  readonly navigate: UseNavigateResult<string>;
}): ReactNode {
  const text = useCopyText();
  const press = props.press;
  return (
    <CenteredPage
      landmark
      title={text(forgeSetupUpdated)}
      primary={
        press === undefined ? (
          <ButtonLink to="/" variant="primary">
            {text({ id: "repositories-home" })}
          </ButtonLink>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              void forgeReturnNavigate(props.navigate, press, undefined);
            }}
          >
            {text({ id: "repositories-continue" })}
          </Button>
        )
      }
    >
      <p>
        {text(
          press === undefined
            ? { id: "repositories-setup-updated-home" }
            : { id: "repositories-setup-updated-continue" },
        )}
      </p>
    </CenteredPage>
  );
}

function ForgeSetupDrawn(props: {
  readonly decision: ForgeSetupDecision;
  readonly navigate: UseNavigateResult<string>;
}): ReactNode {
  const decision = props.decision;
  switch (decision.decision) {
    case "Authorize":
      return <ForgeLandingConnecting />;
    case "Requested":
      return <ForgeLandingBack />;
    case "Updated":
      return (
        <ForgeSetupUpdatedPage
          press={decision.press}
          navigate={props.navigate}
        />
      );
    case "Unexpected":
      return <ForgeLandingUnexpected />;
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
  return <ForgeSetupDrawn decision={decision} navigate={navigate} />;
}
