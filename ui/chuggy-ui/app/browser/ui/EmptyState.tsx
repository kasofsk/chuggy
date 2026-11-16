/**
 * Nothing here, in two to five words, with what to do about it if there is
 * anything.
 *
 * Total over `emptyVariants`: one retired line inside a panel, or a title, one
 * line of explanation and at most one action, centred horizontally in the
 * column a conversation would fill. The action is a way to somewhere that
 * already exists. The title is a heading only at the `level` its caller gives,
 * since the page around it owns its own heading; without one it is a
 * paragraph drawn as a title. It is for a list with no members and never for a
 * read that failed, which is a Notice and says why.
 */

import type { ReactNode } from "react";

import "./EmptyState.css";

export const emptyVariants = ["inline", "page"] as const;

export type EmptyVariant = (typeof emptyVariants)[number];

export const emptyHeadingLevels = [1, 2, 3] as const;

export type EmptyHeadingLevel = (typeof emptyHeadingLevels)[number];

function EmptyStateTitle(props: {
  readonly label: string;
  readonly level: EmptyHeadingLevel | undefined;
}): ReactNode {
  switch (props.level) {
    case undefined:
      return <p className="empty-title">{props.label}</p>;
    case 1:
      return <h1 className="empty-title">{props.label}</h1>;
    case 2:
      return <h2 className="empty-title">{props.label}</h2>;
    case 3:
      return <h3 className="empty-title">{props.label}</h3>;
  }
}

/** `level`, `detail` and `action` are the page variant's; a line inside a
 * panel is its label alone. */
export function EmptyState(props: {
  readonly label: string;
  readonly variant?: EmptyVariant;
  readonly level?: EmptyHeadingLevel;
  readonly detail?: string;
  readonly action?: ReactNode;
}): ReactNode {
  if (props.variant !== "page") return <p className="empty">{props.label}</p>;
  return (
    <div className="empty grid place-content-center gap-3 text-center">
      <EmptyStateTitle label={props.label} level={props.level} />
      {props.detail === undefined ? null : <p>{props.detail}</p>}
      {props.action === undefined ? null : <div>{props.action}</div>}
    </div>
  );
}
