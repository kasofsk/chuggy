/**
 * What is drawn before there is a session, and the router once there is one.
 *
 * A console with no usable configuration says so rather than showing a blank
 * page, because a mounted `/config.json` is the one thing a deployment has to
 * get right and a blank page names nothing. One that got no answer, or a
 * gateway's answer for a server it could not reach, offers to ask again, since
 * a blip says nothing about the deployment.
 *
 * The sign-in names the page it was pressed on, because the issuer redirects to
 * the one address this client is registered with: a page reached with a query
 * it needs — the forge's setup return — would otherwise come back without it.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { currentPath } from "./ports.ts";
import { consoleRouter } from "./routes.tsx";
import {
  sessionBegin,
  useSessionHolder,
  useSessionSnapshot,
  useSilentRefresh,
} from "./session.tsx";
import { Button } from "./ui/Button.tsx";
import { Locomotive } from "./ui/Locomotive.tsx";

function SessionCard(props: {
  readonly title: string;
  readonly detail: string;
  readonly media?: ReactNode;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div className="session-card">
      <h1>{props.title}</h1>
      {props.media}
      <p>{props.detail}</p>
      {props.action}
    </div>
  );
}

export function App(props: { readonly queryClient: QueryClient }): ReactNode {
  const holder = useSessionHolder();
  const snapshot = useSessionSnapshot();
  useSilentRefresh();
  if (snapshot.phase === "Loading")
    return (
      <SessionCard title="chuggy" detail="Loading…" media={<Locomotive />} />
    );
  if (snapshot.phase === "Unconfigured")
    return (
      <SessionCard
        title="Not configured"
        detail={snapshot.reason ?? "No reason given"}
      />
    );
  if (snapshot.phase === "Unreachable")
    return (
      <SessionCard
        title="Unreachable"
        detail={snapshot.reason ?? "No answer"}
        action={
          <Button
            variant="primary"
            onClick={() => {
              void sessionBegin(holder);
            }}
          >
            Retry
          </Button>
        }
      />
    );
  if (snapshot.phase === "SignedOut")
    return (
      <SessionCard
        title="chuggy"
        detail={snapshot.reason ?? "Signed out"}
        action={
          <Button
            variant="primary"
            onClick={() => {
              void holder.signIn(currentPath());
            }}
          >
            Sign in
          </Button>
        }
      />
    );
  return (
    <QueryClientProvider client={props.queryClient}>
      <RouterProvider router={consoleRouter} />
    </QueryClientProvider>
  );
}
