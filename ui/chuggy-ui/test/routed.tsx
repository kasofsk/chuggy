/**
 * A part drawn under a real router, which one that draws a route link needs:
 * a memory history at the root and one root route drawing what the case hands
 * it, so the providers around it reach it as they would without the router.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const routedChildren = createContext<ReactNode>(null);

function RoutedChildren(): ReactNode {
  return useContext(routedChildren);
}

export function Routed(props: { readonly children: ReactNode }): ReactNode {
  const [router] = useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: RoutedChildren }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    }),
  );
  return (
    <routedChildren.Provider value={props.children}>
      <RouterProvider router={router} />
    </routedChildren.Provider>
  );
}
