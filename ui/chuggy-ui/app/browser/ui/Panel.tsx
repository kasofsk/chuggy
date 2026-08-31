/**
 * The chrome a region of the page sits in: a title, a meta slot on the right,
 * a body.
 *
 * Total over `panelVariants` × static or collapsible. The chrome only — a
 * panel holding a read's state is the `DataPanel` composition — so this mounts
 * with no clock and no providers, and a collapsible one is a `details` whose
 * head is its `summary`, which is where the keyboard and the screen reader
 * come from.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import "./Panel.css";

export const panelVariants = ["framed", "quiet"] as const;

export type PanelVariant = (typeof panelVariants)[number];

function PanelHead(props: {
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly level: 2 | 3 | undefined;
  readonly titleId: string | undefined;
}): ReactNode {
  const Heading = props.level === 3 ? "h3" : "h2";
  return (
    <>
      <Heading className="panel-title" id={props.titleId}>
        {props.title}
      </Heading>
      {props.meta === undefined ? null : (
        <span className="panel-meta">{props.meta}</span>
      )}
    </>
  );
}

export function Panel(props: {
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly variant?: PanelVariant;
  readonly level?: 2 | 3;
  readonly collapsible?: { readonly open: boolean };
  readonly children: ReactNode;
}): ReactNode {
  const titleId = useId();
  const framed = `panel${props.variant === "quiet" ? " panel-quiet" : ""}`;
  const body = <div className="panel-body">{props.children}</div>;
  if (props.collapsible !== undefined)
    return (
      <details
        className={`${framed} panel-collapsible`}
        open={props.collapsible.open}
      >
        <summary className="panel-head">
          <PanelHead
            title={props.title}
            meta={props.meta}
            level={props.level}
            titleId={undefined}
          />
        </summary>
        {body}
      </details>
    );
  return (
    <section className={framed} aria-labelledby={titleId}>
      <header className="panel-head">
        <PanelHead
          title={props.title}
          meta={props.meta}
          level={props.level}
          titleId={titleId}
        />
      </header>
      {body}
    </section>
  );
}
