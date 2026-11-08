/**
 * The epics a ticket belongs to, each a link to its page, drawn where a ticket
 * is named. An archived epic is drawn as one, so a reader who follows the link
 * is not surprised that it takes no new ticket.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { pillLookClassName } from "./ui/Pill.tsx";

import "./Epic.css";

export function EpicChips(props: {
  readonly partition: PartitionIdentity;
  readonly epics: TicketResponse["epics"];
}): ReactNode {
  const text = useCopyText();
  if (props.epics === undefined || props.epics.length === 0) return null;
  return (
    <span
      className="epic-chips"
      role="group"
      aria-label={text({ id: "epics-title" })}
    >
      {props.epics.map((epic) => (
        <Link
          key={epic.number}
          to="/$tenant/$project/epics/$epic"
          params={{ ...props.partition, epic: String(epic.number) }}
          className={pillLookClassName({ tone: "neutral" })}
        >
          {epic.visibility === "Archived"
            ? text({ id: "epics-chip-archived", args: { title: epic.title } })
            : epic.title}
        </Link>
      ))}
    </span>
  );
}
