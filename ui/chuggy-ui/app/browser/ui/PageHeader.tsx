/**
 * The head of a page: a back link, the title with its number, the description
 * under it, the status mark on a row with the actions, and whatever else the
 * page draws under them.
 * Once the header has scrolled out of view, a thin bar holding the status, the
 * title and the primary action sticks to the top of the page in its place.
 *
 * The actions are values rather than elements, so the header is what draws
 * them: `primary` is one action or none, and `secondary` are drawn in the
 * default variant whatever the caller wanted, so of the actions the header
 * draws, at most one is primary. `overflow`, `status` and `children` are
 * slots, and what a page puts in them is its own.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { LinkOptions } from "@tanstack/react-router";

import { Breadcrumb, BreadcrumbLink } from "./Breadcrumb.tsx";
import { Button, ButtonLink } from "./Button.tsx";
import type { ButtonSize, ButtonVariant } from "./Button.tsx";

import "./PageHeader.css";

/** An action the header draws: a press, or a route it navigates to. */
export type PageHeaderAction =
  | {
      readonly label: string;
      readonly onPress: () => void;
      readonly busy?: boolean;
      readonly disabled?: boolean;
    }
  | { readonly label: string; readonly link: LinkOptions };

export interface PageHeaderBack {
  readonly label: string;
  readonly link: LinkOptions;
}

// jscpd:ignore-start -- the ticket header's own observer, lifted as it is so adopting this changes nothing
/** Whether the element is out of view, which nothing says until it has been
 * observed and a browser without the observer never says. */
function usePageHeaderScrolledAway(
  ref: RefObject<HTMLElement | null>,
): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined")
      return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) setAway(!entry.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return away;
}
// jscpd:ignore-end -- the lifted observer ends here

function PageHeaderActionDrawn(props: {
  readonly action: PageHeaderAction;
  readonly variant: ButtonVariant;
  readonly size: ButtonSize;
}): ReactNode {
  const action = props.action;
  if ("link" in action)
    return (
      <ButtonLink {...action.link} variant={props.variant} size={props.size}>
        {action.label}
      </ButtonLink>
    );
  return (
    <Button
      variant={props.variant}
      size={props.size}
      onClick={action.onPress}
      busy={action.busy ?? false}
      disabled={action.disabled ?? false}
    >
      {action.label}
    </Button>
  );
}

function PageHeaderTitle(props: {
  readonly title: string;
  readonly number?: number | undefined;
}): ReactNode {
  return (
    <h1 className="page-header-title">
      {props.title}
      {props.number === undefined ? null : (
        <>
          {" "}
          <span className="page-header-number">{`#${String(props.number)}`}</span>
        </>
      )}
    </h1>
  );
}

/** What the header offers, as the caller handed it. */
interface PageHeaderOffered {
  readonly primary?: PageHeaderAction | undefined;
  readonly secondary?: readonly PageHeaderAction[] | undefined;
  readonly overflow?: ReactNode;
}

function pageHeaderActionsAny(props: PageHeaderOffered): boolean {
  return (
    props.primary !== undefined ||
    (props.secondary ?? []).length > 0 ||
    props.overflow !== undefined
  );
}

function PageHeaderActions(props: PageHeaderOffered): ReactNode {
  const secondary = props.secondary ?? [];
  return (
    <div className="page-header-actions">
      {secondary.map((action) => (
        <PageHeaderActionDrawn
          key={action.label}
          action={action}
          variant="default"
          size="sm"
        />
      ))}
      {props.primary === undefined ? null : (
        <PageHeaderActionDrawn
          action={props.primary}
          variant="primary"
          size="sm"
        />
      )}
      {props.overflow}
    </div>
  );
}

/** The row under the title: the status, and the actions at its far end. */
function PageHeaderStanding(
  props: PageHeaderOffered & { readonly status?: ReactNode },
): ReactNode {
  const actions = pageHeaderActionsAny(props);
  if (props.status === undefined && !actions) return null;
  return (
    <div className="page-header-standing">
      {props.status === undefined ? null : (
        <div className="page-header-status">{props.status}</div>
      )}
      {actions ? <PageHeaderActions {...props} /> : null}
    </div>
  );
}

/** The bar that stands in for the header once it is out of view. */
function PageHeaderBar(props: {
  readonly away: boolean;
  readonly title: string;
  readonly status?: ReactNode;
  readonly primary?: PageHeaderAction | undefined;
}): ReactNode {
  return (
    <div className="page-header-sticky">
      <div className="page-header-sticky-bar" hidden={!props.away}>
        {props.status}
        <span className="page-header-sticky-title">{props.title}</span>
        {props.primary === undefined ? null : (
          <span className="page-header-sticky-action">
            <PageHeaderActionDrawn
              action={props.primary}
              variant="primary"
              size="sm"
            />
          </span>
        )}
      </div>
    </div>
  );
}

export function PageHeader(
  props: PageHeaderOffered & {
    readonly title: string;
    readonly number?: number;
    readonly back?: PageHeaderBack;
    readonly status?: ReactNode;
    /** The status as the condensed bar draws it, where it is drawn smaller. */
    readonly statusCondensed?: ReactNode;
    readonly description?: string;
    readonly children?: ReactNode;
  },
): ReactNode {
  const header = useRef<HTMLElement>(null);
  const away = usePageHeaderScrolledAway(header);
  return (
    <>
      <PageHeaderBar
        away={away}
        title={props.title}
        status={props.statusCondensed ?? props.status}
        primary={props.primary}
      />
      <header ref={header} className="page-header">
        {props.back === undefined ? null : (
          <Breadcrumb>
            <BreadcrumbLink {...props.back.link}>
              {props.back.label}
            </BreadcrumbLink>
          </Breadcrumb>
        )}
        <PageHeaderTitle title={props.title} number={props.number} />
        {props.description === undefined ? null : (
          <p className="page-header-description">{props.description}</p>
        )}
        <PageHeaderStanding
          status={props.status}
          primary={props.primary}
          secondary={props.secondary}
          overflow={props.overflow}
        />
        {props.children}
      </header>
    </>
  );
}
