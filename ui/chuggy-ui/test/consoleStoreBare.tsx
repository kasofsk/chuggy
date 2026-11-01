/**
 * A store for a case that draws no tree, or a tree with no session and no
 * query client: over the `fetch` the case stubs, a session double, and a
 * query client of its own or the one it hands in.
 */

import { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { apiFetch, sleepMs } from "../app/browser/ports.ts";
import { consoleStore } from "../app/browser/store.ts";
import type { ConsoleStore } from "../app/browser/store.ts";
import { apiPortsOver } from "../app/core/apiPorts.ts";
import { holderDouble } from "./screenHarness.tsx";

export function consoleStoreBare(
  client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
): ConsoleStore {
  return consoleStore({
    ports: apiPortsOver(holderDouble(), apiFetch, sleepMs),
    client,
  });
}

/** One bare store per mount of a tree that reads nothing through it. */
export function ConsoleStoreBareProvided(props: {
  readonly children: ReactNode;
}): ReactNode {
  const [store] = useState(() => consoleStoreBare());
  return <Provider store={store}>{props.children}</Provider>;
}
