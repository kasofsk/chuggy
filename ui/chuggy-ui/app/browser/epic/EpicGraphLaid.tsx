/**
 * An epic's graph laid out, handed to what draws it. It is the Graph tab's
 * lazily loaded chunk, and holds the layout and nothing that draws, so the
 * chunk carries dagre and none of the page's own modules.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";

import type { EpicGraphResponse } from "../../../../../src/contract/responses.ts";
import type { EpicGraphDrawn, EpicGraphTicket } from "../../core/epicGraph.ts";
import { epicGraphDrawn } from "../../core/epicGraphLayout.ts";

export default function EpicGraphLaid(props: {
  readonly graph: EpicGraphResponse;
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
  readonly outsideShown: boolean;
  readonly children: (drawn: EpicGraphDrawn) => ReactNode;
}): ReactNode {
  const { graph, tickets, outsideShown } = props;
  const drawn = useMemo(
    () => epicGraphDrawn(graph, tickets, outsideShown),
    [graph, tickets, outsideShown],
  );
  return props.children(drawn);
}
