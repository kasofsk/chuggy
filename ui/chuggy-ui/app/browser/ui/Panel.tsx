/**
 * The chrome a region of the page sits in: a title, the line under it saying
 * what the region holds, a meta slot on the right, a body, and a foot the
 * region's own actions sit in.
 *
 * Total over `panelVariants` × static or collapsible. The chrome only — a
 * panel holding a read's state is the `DataPanel` composition — so this mounts
 * with no clock and no providers. The collapsible form is Radix `Collapsible`
 * with the heading wrapping the trigger, which is where the keyboard and the
 * screen reader come from.
 */

import { Collapsible } from "radix-ui";
import { useId } from "react";
import type { ReactNode } from "react";

import { Chevron } from "./Chevron.tsx";

import "./Panel.css";

export const panelVariants = ["framed", "quiet", "section"] as const;

export type PanelVariant = (typeof panelVariants)[number];

interface PanelLook {
  readonly root: string;
  readonly head: string;
  readonly body: string;
}

function panelLook(variant: PanelVariant | undefined): PanelLook {
  switch (variant) {
    case "quiet":
      return {
        root: "min-w-0",
        head: "panel-head px-0",
        body: "panel-body px-0",
      };
    case "section":
      return {
        root: "bg-surface-1 border-edge rounded-2 min-w-0 border",
        head: "panel-head panel-head-ruled",
        body: "panel-body panel-body-ruled",
      };
    case "framed":
    case undefined:
      return {
        root: "bg-surface-1 border-edge rounded-3 min-w-0 border",
        head: "panel-head",
        body: "panel-body",
      };
  }
}

function PanelMeta(props: { readonly meta: ReactNode }): ReactNode {
  if (props.meta === undefined) return null;
  return <span className="panel-meta">{props.meta}</span>;
}

/** The one line under the title saying what the region holds, for a region
 * whose title is not enough on its own. */
function PanelAbout(props: { readonly about: string | undefined }): ReactNode {
  if (props.about === undefined) return null;
  return <span className="panel-about">{props.about}</span>;
}

function PanelFoot(props: { readonly foot: ReactNode }): ReactNode {
  if (props.foot === undefined) return null;
  return <footer className="panel-foot">{props.foot}</footer>;
}

/** Whether a collapsible panel is open: where it opens first, unless its
 * caller holds that and hears each change of it. */
interface PanelOpen {
  readonly open: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

function PanelCollapsible(props: {
  readonly title: ReactNode;
  readonly meta: ReactNode;
  readonly level: 2 | 3 | undefined;
  readonly look: PanelLook;
  readonly open: PanelOpen;
  readonly children: ReactNode;
}): ReactNode {
  const Heading = props.level === 3 ? "h3" : "h2";
  const open = props.open;
  return (
    <Collapsible.Root
      className={props.look.root}
      {...(open.onOpenChange === undefined
        ? { defaultOpen: open.open }
        : { open: open.open, onOpenChange: open.onOpenChange })}
    >
      <div className={props.look.head}>
        <Heading className="panel-title min-w-0 grow">
          <Collapsible.Trigger className="panel-trigger flex w-full min-w-0 items-center gap-2">
            <span className="min-w-0 grow">{props.title}</span>
            <Chevron className="panel-chevron" />
          </Collapsible.Trigger>
        </Heading>
        <PanelMeta meta={props.meta} />
      </div>
      <Collapsible.Content>
        <div className={props.look.body}>{props.children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function Panel(props: {
  readonly title: ReactNode;
  readonly about?: string;
  readonly meta?: ReactNode;
  readonly foot?: ReactNode;
  readonly variant?: PanelVariant;
  readonly level?: 2 | 3;
  readonly collapsible?: PanelOpen;
  readonly children: ReactNode;
}): ReactNode {
  const titleId = useId();
  const look = panelLook(props.variant);
  const Heading = props.level === 3 ? "h3" : "h2";
  if (props.collapsible !== undefined)
    return (
      <PanelCollapsible
        title={props.title}
        meta={props.meta}
        level={props.level}
        look={look}
        open={props.collapsible}
      >
        {props.children}
      </PanelCollapsible>
    );
  return (
    <section className={look.root} aria-labelledby={titleId}>
      <header className={look.head}>
        <span className="panel-named">
          <Heading className="panel-title" id={titleId}>
            {props.title}
          </Heading>
          <PanelAbout about={props.about} />
        </span>
        <PanelMeta meta={props.meta} />
      </header>
      <div className={look.body}>{props.children}</div>
      <PanelFoot foot={props.foot} />
    </section>
  );
}
