/**
 * Where the console's ports reach the network in a suite that mounts the
 * whole console: the site the suite holds. Apart from `consoleSite.tsx`
 * because a file's `vi.mock` factory for `ports.ts` imports this, and a
 * module that reached `ports.ts` itself would be imported before its mock.
 */

import type * as BrowserPorts from "../app/browser/ports.ts";

export interface ConsoleNetwork {
  readonly apiFetch: typeof BrowserPorts.apiFetch;
  readonly streamFetch: typeof BrowserPorts.streamFetch;
}

/** The network every mount in a file reaches, made afresh for each case. */
export const consoleNetworkHeld: { current: ConsoleNetwork | undefined } = {
  current: undefined,
};

function consoleNetworkCurrent(): ConsoleNetwork {
  if (consoleNetworkHeld.current === undefined)
    throw new Error("the console reached the network before a site was made");
  return consoleNetworkHeld.current;
}

/** `ports.ts` as the console has it, with the network the held one. A worker
 * that colours code is one that could not start, which is a state the
 * console already draws. */
export function consolePortsOver(
  original: typeof BrowserPorts,
): typeof BrowserPorts {
  return {
    ...original,
    apiFetch: (url, init) => consoleNetworkCurrent().apiFetch(url, init),
    streamFetch: (url, init) => consoleNetworkCurrent().streamFetch(url, init),
    syntaxWorkerOpened: (heard) => {
      heard({ failed: true });
      return { ask: () => undefined, end: () => undefined };
    },
  };
}
