/**
 * The router's `createLink`, standing a link's route in for the address the
 * router would resolve it to, so a primitive's links are drawn with no
 * provider around them and are links to whoever reads their role. A suite
 * mocks the router with this module.
 */

import type { ReactNode } from "react";

interface RouterLinkStub {
  readonly to?: string;
  readonly href?: string | undefined;
  readonly children?: ReactNode;
}

export function createLink(
  component: (props: RouterLinkStub) => ReactNode,
): (props: RouterLinkStub) => ReactNode {
  return (props) => component({ ...props, href: props.to });
}
