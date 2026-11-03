/**
 * The doubles the shell's cases mock the router and the ports with, taken by a
 * `vi.mock` factory through a dynamic import: a factory that imported a module
 * drawing the shell would wait on the mock it is building.
 */

import type { ComponentProps, ReactNode } from "react";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";
import type { PartitionIdentity } from "../../../src/contract/http.ts";

/** The ports with the sleep ended at once. */
export function portsDouble(original: typeof BrowserPorts) {
  return { ...original, sleepMs: () => Promise.resolve() };
}

export const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** The router with the route taken from a case: `outlet` draws the page and
 * `params` names the route's parameters. */
export function routerDouble(
  original: typeof RouterModule,
  route: {
    readonly outlet: () => ReactNode;
    readonly params: () => PartitionIdentity & { readonly session?: string };
  },
) {
  return {
    ...original,
    /** A menu item draws its link through `asChild`, so the double keeps the
     * role, focus and handlers the item hands it, and only the route is
     * dropped. */
    Link: (
      props: ComponentProps<"a"> & {
        readonly to?: unknown;
        readonly params?: unknown;
        readonly activeOptions?: unknown;
      },
    ) => (
      <a
        {...Object.fromEntries(
          Object.entries(props).filter(
            ([key]) => !["to", "params", "activeOptions"].includes(key),
          ),
        )}
        href="/"
      />
    ),
    Outlet: () => route.outlet(),
    useNavigate: () => () => undefined,
    useParams: () => route.params(),
    /** Copy link asks the router for the address, which these cases do not read. */
    useRouter: () => ({ buildLocation: () => ({ href: "/" }) }),
    useRouterState: (options: {
      readonly select: (state: {
        readonly location: { readonly pathname: string };
      }) => unknown;
    }) => options.select({ location: { pathname: "/acme/atlas" } }),
  };
}
