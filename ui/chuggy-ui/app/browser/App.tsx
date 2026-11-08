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
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import { copyOrDataText } from "../core/copy.ts";
import { inviteRoutePath } from "../core/inviteLinks.ts";
import { InvitePage } from "./InvitePage.tsx";
import { currentLocation } from "./ports.ts";
import { consoleRouter } from "./routes.tsx";
import { SessionCard, SignedOutCard } from "./SessionCard.tsx";
import {
  sessionBegin,
  useSessionHolder,
  useSessionSnapshot,
  useSilentRefresh,
} from "./session.tsx";
import { Button } from "./ui/Button.tsx";
import { Locomotive } from "./ui/Locomotive.tsx";

export function App(props: { readonly queryClient: QueryClient }): ReactNode {
  const holder = useSessionHolder();
  const snapshot = useSessionSnapshot();
  const text = useCopyText();
  useSilentRefresh();
  if (snapshot.phase === "Loading")
    return (
      <SessionCard
        title={text({ id: "session-brand" })}
        detail={text({ id: "session-loading" })}
        media={<Locomotive />}
      />
    );
  if (snapshot.phase === "Unconfigured")
    return (
      <SessionCard
        title={text({ id: "session-unconfigured" })}
        detail={copyOrDataText(
          text,
          snapshot.reason ?? { id: "session-unconfigured-unsaid" },
        )}
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
  return (
    <QueryClientProvider client={props.queryClient}>
      <RouterProvider router={consoleRouter} />
    </QueryClientProvider>
  );
}
