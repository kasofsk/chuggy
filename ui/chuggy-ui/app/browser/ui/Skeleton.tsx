/**
 * Where a read's value will stand, drawn before it arrives in roughly the
 * shape it will take, so the page does not jump when it does.
 *
 * Total over `skeletonShapes`: a line of text, a row of a list, or a card. The
 * region is marked busy and says `label` to a reader who does not see the
 * page; the blocks are hidden from one, since they say nothing.
 */

import type { ReactNode } from "react";

import "./Skeleton.css";

export const skeletonShapes = ["line", "row", "card"] as const;

export type SkeletonShape = (typeof skeletonShapes)[number];

function SkeletonBlocks(props: { readonly shape: SkeletonShape }): ReactNode {
  switch (props.shape) {
    case "line":
      return <span className="skeleton-block skeleton-line" />;
    case "row":
      return <span className="skeleton-block skeleton-row" />;
    case "card":
      return (
        <span className="skeleton-card">
          <span className="skeleton-block skeleton-line" />
          <span className="skeleton-block skeleton-row" />
        </span>
      );
  }
}

export function Skeleton(props: {
  readonly shape: SkeletonShape;
  readonly label: string;
}): ReactNode {
  return (
    <div className="skeleton" aria-busy="true">
      <span className="visually-hidden">{props.label}</span>
      <span className="skeleton-shape" aria-hidden="true">
        <SkeletonBlocks shape={props.shape} />
      </span>
    </div>
  );
}
