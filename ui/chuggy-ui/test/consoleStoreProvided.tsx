/**
 * A case's own store, provided the way `main.tsx` provides the console's: one
 * per mount of the tree, or the case's own where it must outlive one.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { consoleStore } from "../app/browser/store.ts";
import type { ConsoleStore } from "../app/browser/store.ts";

export function ConsoleStoreProvided(props: {
  readonly store?: ConsoleStore | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const [store] = useState(() => props.store ?? consoleStore());
  return <Provider store={store}>{props.children}</Provider>;
}
