/**
 * The router as an epic's page meets it: the epic its address names, which a
 * case may move, each link an anchor at the address it would go to, its search
 * included, carrying what it is labelled and titled by, and each navigation
 * recorded where it was asked to go.
 */

import type { ReactNode } from "react";

import { leadPartition } from "./leadFixture.ts";

/** The epic the address names. */
export const epicRouted = { epic: "7" };

/** Where each navigation was asked to go, as the address it names. */
export const epicNavigated: string[] = [];

function epicAddress(
  to: string | undefined,
  params: Readonly<Record<string, string>> | undefined,
  search: Readonly<Record<string, unknown>> | undefined,
): string {
  const path = (to ?? "/").replace(
    /\$(\w+)/gu,
    (named: string, key: string) => params?.[key] ?? named,
  );
  const query = new URLSearchParams(
    Object.entries(search ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString();
  return query === "" ? path : `${path}?${query}`;
}

function EpicLink(
  props: Readonly<Record<string, unknown>> & {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly search?: Readonly<Record<string, unknown>>;
    readonly children?: ReactNode;
    readonly className?: string;
    readonly title?: string;
    readonly "aria-label"?: string;
  },
): ReactNode {
  return (
    <a
      className={props.className}
      title={props.title}
      aria-label={props["aria-label"]}
      href={epicAddress(props.to, props.params, props.search)}
    >
      {props.children}
    </a>
  );
}

export const epicRouterDouble = {
  createLink: (component: unknown) => component,
  Link: EpicLink,
  useParams: () => ({ ...leadPartition, epic: epicRouted.epic }),
  useNavigate:
    () =>
    (options: {
      readonly to?: string;
      readonly params?: Readonly<Record<string, string>>;
      readonly search?: Readonly<Record<string, unknown>>;
    }) => {
      epicNavigated.push(
        epicAddress(options.to, options.params, options.search),
      );
      return Promise.resolve();
    },
};
