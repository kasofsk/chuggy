/**
 * The router as an epic's page meets it: the epic its address names, which a
 * case may move, each link an anchor at the address it would go to, its search
 * included, carrying what it is labelled and titled by, and each navigation
 * recorded where it was asked to go unless a blocker the page holds refused
 * it.
 */

import { useEffect } from "react";
import type { ReactNode } from "react";

import { projectPartition } from "./projectFixture.ts";

/** The epic the address names. */
export const epicRouted = { epic: "7" };

/** Where each navigation was asked to go, as the address it names. */
export const epicNavigated: string[] = [];

/** The blockers the page holds while mounted, each asked before a navigation. */
const epicBlockers = new Set<() => boolean>();

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
  createLink: () => EpicLink,
  Link: EpicLink,
  useParams: () => ({ ...projectPartition, epic: epicRouted.epic }),
  useBlocker: (options: { readonly shouldBlockFn: () => boolean }) => {
    useEffect(() => {
      epicBlockers.add(options.shouldBlockFn);
      return () => {
        epicBlockers.delete(options.shouldBlockFn);
      };
    }, [options.shouldBlockFn]);
  },
  useNavigate:
    () =>
    (options: {
      readonly to?: string;
      readonly params?: Readonly<Record<string, string>>;
      readonly search?: Readonly<Record<string, unknown>>;
    }) => {
      if ([...epicBlockers].some((blocked) => blocked()))
        return Promise.resolve();
      epicNavigated.push(
        epicAddress(options.to, options.params, options.search),
      );
      return Promise.resolve();
    },
};
