/**
 * A case's own store, provided the way `main.tsx` provides the console's: one
 * per mount of the tree, over the ports and the query client the tree reads,
 * or the case's own where it must outlive one.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { useApiPorts } from "../app/browser/api.ts";
import { consoleStore } from "../app/browser/store.ts";
import type { ConsoleStore } from "../app/browser/store.ts";

export function ConsoleStoreProvided(props: {
  readonly store?: ConsoleStore | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [store] = useState(
    () => props.store ?? consoleStore({ ports, client }),
  );
  return <Provider store={store}>{props.children}</Provider>;
}
