/**
 * The epics a ticket belongs to, each a link to its page, drawn where a ticket
 * is named: the number, which is never cut, then the title cut short. The link
 * is named by the whole title and number, so a hover and a screen reader read
 * what the chip cut, and its parts are spaced as that name is, so the name
 * holds the words drawn. An archived epic is drawn as one, so a reader who follows
 * the link is not surprised that it takes no new ticket.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { chipClassName } from "./ui/Chip.tsx";

import "./Epic.css";

type Epic = NonNullable<TicketResponse["epics"]>[number];

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
        <EpicChipsChip
          key={epic.number}
          partition={props.partition}
          epic={epic}
        />
      ))}
    </span>
  );
}

function EpicChipsChip(props: {
  readonly partition: PartitionIdentity;
  readonly epic: Epic;
}): ReactNode {
  const text = useCopyText();
  const { epic } = props;
  const args = { title: epic.title, epic: String(epic.number) };
  const archived = epic.visibility === "Archived";
  const name = archived
    ? text({ id: "epics-chip-name-archived", args })
    : text({ id: "epics-chip-name", args });
  return (
    <Link
      to="/$tenant/$project/epics/$epic"
      params={{ ...props.partition, epic: String(epic.number) }}
      className={`${chipClassName} epic-chip`}
      aria-label={name}
      title={name}
    >
      <span className="epic-chip-number">
        {text({ id: "epics-chip-number", args: { epic: args.epic } })}
      </span>{" "}
      <span className="epic-chip-title">{epic.title}</span>
      {archived ? " " : null}
      {archived ? (
        <span className="epic-chip-archived">
          {text({ id: "epics-chip-archived" })}
        </span>
      ) : null}
    </Link>
  );
}
