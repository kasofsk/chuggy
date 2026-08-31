/**
 * Nothing here, in two to five words, with what to do about it if there is
 * anything.
 *
 * Total over `emptyVariants`: one retired line inside a panel, or a centred
 * card for a console with no session and no page to draw. It is for a list with
 * no members and never for a read that failed, which is a Notice and says why.
 */

import type { ReactNode } from "react";

import "./EmptyState.css";

export const emptyVariants = ["inline", "page"] as const;

export type EmptyVariant = (typeof emptyVariants)[number];

export function EmptyState(props: {
  readonly label: string;
  readonly variant?: EmptyVariant;
  readonly detail?: string;
  readonly action?: ReactNode;
}): ReactNode {
  if (props.variant !== "page") return <p className="empty">{props.label}</p>;
  return (
    <div className="empty empty-page">
      <h1>{props.label}</h1>
      {props.detail === undefined ? null : <p>{props.detail}</p>}
      {props.action === undefined ? null : (
        <div className="empty-action">{props.action}</div>
      )}
    </div>
  );
}
