/**
 * A new ticket started from this one, offered in every phase to a reader who
 * may open one. It is a link and not a submission: what the new ticket sends
 * is written on the form it opens.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { ticketDuplicateEffect } from "../../core/codeLabels.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { ButtonLink } from "../ui/Button.tsx";

export function TicketDuplicateOffer(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: number;
}): ReactNode {
  const abilities = useProjectAbilities(props.partition);
  if (projectAbilityRefused(abilities, "mutate")) return null;
  return (
    <div className="act">
      <div className="act-head">
        <ButtonLink
          to="/$tenant/$project/tickets/new"
          params={props.partition}
          search={{ from: props.ticket }}
        >
          Duplicate
        </ButtonLink>
      </div>
      <p className="act-effect">{ticketDuplicateEffect}</p>
    </div>
  );
}
