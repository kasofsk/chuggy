/* eslint-disable copy/no-literal-text */
/**
 * An epic's members and the tickets outside it that they wait on, laid out by
 * `core/epics.ts` with each edge running from a dependency to the ticket that
 * depends on it. A member is drawn as a filled node and an outside ticket as
 * an outlined one, so which tickets the epic holds is not carried by hue. A
 * label cut to fit its node is read whole in its link's name and its title.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { EpicGraphResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  epicGraphLayout,
  epicGraphNodeHeight,
  epicGraphNodeWidth,
  epicGraphStanding,
} from "../core/epics.ts";
import { phaseTone } from "../core/tones.ts";

import "./Epic.css";

export function EpicGraph(props: {
  readonly partition: PartitionIdentity;
  readonly graph: EpicGraphResponse;
}): ReactNode {
  const text = useCopyText();
  const layout = epicGraphLayout(props.graph, text);
  if (layout.nodes.length === 0)
    return <p className="panel-note">No tickets.</p>;
  return (
    <div className="epic-graph-scroll">
      <svg
        className="epic-graph"
        role="group"
        aria-label="Tickets of the epic and what they wait on"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      >
        {layout.edges.map((edge) => (
          <path
            key={`${String(edge.from.ticket)}-${String(edge.to.ticket)}`}
            className="epic-graph-edge"
            d={`M ${String(edge.from.x + epicGraphNodeWidth)} ${String(edge.from.y + epicGraphNodeHeight / 2)} L ${String(edge.to.x)} ${String(edge.to.y + epicGraphNodeHeight / 2)}`}
          />
        ))}
        {layout.nodes.map((node) => (
          <Link
            key={node.ticket}
            to="/$tenant/$project/tickets/$ticket"
            params={{ ...props.partition, ticket: String(node.ticket) }}
            aria-label={`Ticket ${String(node.ticket)}${node.title === undefined ? "" : ` ${node.title}`}, ${text(epicGraphStanding(node))}${node.member ? "" : ", outside the epic"}`}
          >
            <g
              className={
                node.phase === undefined
                  ? "epic-graph-node"
                  : `epic-graph-node epic-graph-${phaseTone(node.phase)}`
              }
              data-member={node.member ? "" : undefined}
              data-external={node.member ? undefined : ""}
            >
              <rect
                x={node.x}
                y={node.y}
                width={epicGraphNodeWidth}
                height={epicGraphNodeHeight}
                rx="6"
              />
              <title>{`#${String(node.ticket)} ${node.title ?? text(epicGraphStanding(node))}`}</title>
              <text x={node.x + 8} y={node.y + epicGraphNodeHeight / 2 + 4}>
                {node.label}
              </text>
            </g>
          </Link>
        ))}
      </svg>
    </div>
  );
}
