/**
 * The router as an epic's page meets it: the epic its address names, which a
 * case may move, and each link an anchor at the address it would go to,
 * carrying what it is labelled and titled by.
 */

import type { ReactNode } from "react";

import { leadPartition } from "./leadFixture.ts";

/** The epic the address names. */
export const epicRouted = { epic: "7" };

function EpicLink(
  props: Readonly<Record<string, unknown>> & {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly title?: string;
    readonly "aria-label"?: string;
  },
): ReactNode {
  const { params } = props;
  return (
    <a
      className={props.className}
      title={props.title}
      aria-label={props["aria-label"]}
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  );
}

export const epicRouterDouble = {
  createLink: (component: unknown) => component,
  Link: EpicLink,
  useParams: () => ({ ...leadPartition, epic: epicRouted.epic }),
  useNavigate: () => () => Promise.resolve(),
};
