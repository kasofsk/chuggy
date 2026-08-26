/**
 * What is drawn before there is a session, and the router once there is one.
 *
 * A console with no readable configuration says so rather than showing a blank
 * page, because a mounted `/config.json` is the one thing a deployment has to
 * get right and a blank page names nothing.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { consoleConfigurationPath } from "../core/configuration.ts";
import { consoleRouter } from "./routes.tsx";
import {
  useSessionHolder,
  useSessionSnapshot,
  useSilentRefresh,
} from "./session.tsx";

function Notice(props: {
  readonly title: string;
  readonly detail: string;
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <div className="notice">
      <h1>{props.title}</h1>
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
      <Notice
        title="chuggy"
        detail="reading this deployment's configuration…"
      />
    );
  if (snapshot.phase === "Unconfigured")
    return (
      <Notice
        title="not configured"
        detail={`${consoleConfigurationPath} could not be read: ${snapshot.reason ?? "no reason was given"}`}
      />
    );
  if (snapshot.phase === "SignedOut")
    return (
      <Notice
        title="chuggy"
        detail={snapshot.reason ?? "this browser holds no session."}
        action={
          <button
            type="button"
            onClick={() => {
              void holder.signIn();
            }}
          >
            sign in
          </button>
        }
      />
    );
  return (
    <QueryClientProvider client={props.queryClient}>
      <RouterProvider router={consoleRouter} />
    </QueryClientProvider>
  );
}
