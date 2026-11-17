/**
 * One part of a line whose parts a middle dot separates, kept whole: the line
 * breaks only before a dot, so none ends on one and a wrapped line begins with
 * the dot and its words. The first part has no dot in front of it.
 */

import type { ReactNode } from "react";

export function LinePart(props: {
  readonly first?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  if (props.first === true)
    return <span className="whitespace-nowrap">{props.children}</span>;
  return (
    <>
      {" "}
      <span className="whitespace-nowrap">
        {"· "}
        {props.children}
      </span>
    </>
  );
}
