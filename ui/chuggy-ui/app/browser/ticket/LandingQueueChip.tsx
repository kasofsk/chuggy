/**
 * A ticket's place in its landing queue, as `position/total` on the status
 * badge of its tone, with the place in words on hover and as its name. A
 * ticket in no queue draws nothing, and so does every ticket while the read is
 * out or has failed, since the read is then nothing.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { LandingQueuesResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  landingQueuePlaceFigure,
  landingQueuePlaceTone,
  landingQueuePlaceWords,
} from "../../core/landingQueues.ts";
import type { LandingQueuePlace } from "../../core/landingQueues.ts";
import { landingQueuesQuery } from "../../core/ticketQueries.ts";
import { usePanelState } from "../api.ts";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { readValue } from "../../core/freshness.ts";

import "./ticket.css";

/** The project's landing queues, read once by the page that draws chips from
 * them; nothing while the read is out or has failed. */
export function useLandingQueues(
  partition: PartitionIdentity,
): LandingQueuesResponse | undefined {
  return readValue(usePanelState(landingQueuesQuery(partition)));
}

/** The place `landingQueuePlaceOf` answers, nothing where it answers none. */
export function LandingQueueChip(props: {
  readonly place: LandingQueuePlace | undefined;
  /** Inside a link or button, whose own focus the chip must not split, the
   * words are the chip's name alone: the ticket's page draws them on hover or
   * press. */
  readonly inLink?: boolean | undefined;
}): ReactNode {
  const text = useCopyText();
  const place = props.place;
  if (place === undefined) return null;
  const tone = landingQueuePlaceTone(place);
  const words = text(landingQueuePlaceWords(place));
  const chip = (
    <span
      className="finalization-queue-chip"
      role="img"
      aria-label={words}
      data-holding={place.holding || undefined}
    >
      <StatusBadge tone={tone} size="small">
        {text(landingQueuePlaceFigure(place))}
      </StatusBadge>
    </span>
  );
  return props.inLink === true ? (
    chip
  ) : (
    <Tooltip trigger="abbreviation" text={words}>
      {chip}
    </Tooltip>
  );
}
