/**
 * What is drawn before there is a session, and the router once there is one.
 *
 * A console with no usable configuration says so rather than showing a blank
 * page, because a mounted `/config.json` is the one thing a deployment has to
 * get right and a blank page names nothing. One that got no answer, or a
 * gateway's answer for a server it could not reach, offers to ask again, since
 * a blip says nothing about the deployment.
 *
 * A browser with no session at the invite page's address is drawn that page,
 * which is the one address a person without an account is sent to.
 *
 * A signed-in person is drawn the router, at whatever address the browser is
 * on, through the agreement gate. Where the configuration says `agreements`
 * the gate reads under `/agreements/v1` before the router is drawn; where it
 * does not, the router is drawn at once, and the gate reads there only once
 * the API refuses the person for want of agreement.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import { copyOrDataText } from "../core/copy.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import { AgreementGate } from "./AgreementPage.tsx";
import { InvitePage } from "./InvitePage.tsx";
import { currentLocation } from "./ports.ts";
import { consoleRouter } from "./routes.tsx";
import {
  SessionCard,
  SessionOpeningCard,
  SignedOutCard,
} from "./SessionCard.tsx";
import {
  sessionBegin,
  useSessionHolder,
  useSessionSnapshot,
  useSilentRefresh,
} from "./session.tsx";
import { Button } from "./ui/Button.tsx";

export function App(props: { readonly queryClient: QueryClient }): ReactNode {
  const holder = useSessionHolder();
  const snapshot = useSessionSnapshot();
  const text = useCopyText();
  useSilentRefresh();
  if (snapshot.phase === "Loading") return <SessionOpeningCard />;
  if (snapshot.phase === "Unconfigured")
    return (
      <SessionCard
        title={text({ id: "session-unconfigured" })}
        detail={copyOrDataText(
          text,
          snapshot.reason ?? { id: "session-unconfigured-unsaid" },
        )}
        next={text({ id: "session-unconfigured-next" })}
      />
    );
  if (snapshot.phase === "Unreachable")
    return (
      <SessionCard
        title={text({ id: "session-unreachable" })}
        detail={copyOrDataText(
          text,
          snapshot.reason ?? { id: "session-unreachable-unsaid" },
        )}
        next={text({ id: "session-unreachable-next" })}
        action={
          <Button
            variant="primary"
            onClick={() => {
              void sessionBegin(holder);
            }}
          >
            {text({ id: "session-retry" })}
          </Button>
        }
      />
    );
  if (snapshot.phase === "SignedOut")
    return currentLocation().pathname === inviteRoutePath ? (
      <InvitePage />
    ) : (
      <SignedOutCard />
    );
  const router = (
    <QueryClientProvider client={props.queryClient}>
      <RouterProvider router={consoleRouter} />
    </QueryClientProvider>
  );
  return (
    <AgreementGate asked={snapshot.configuration?.agreements === true}>
      {router}
    </AgreementGate>
  );
}
