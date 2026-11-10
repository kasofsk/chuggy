/**
 * A ticket's place in its landing queue, as a merge mark and `position/total`
 * with the place in words on hover and as its name. A ticket in no queue draws
 * nothing, and so does every ticket while the read is out or has failed, since
 * the read is then nothing.
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
import { pillLookClassName } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { readValue } from "./TicketPageHeld.tsx";
import { TicketRunMarkDrawn } from "./TicketRunMark.tsx";

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
  /** Inside a link, whose own focus the chip must not split, the words are a
   * title rather than a tooltip that takes focus. */
  readonly inLink?: boolean | undefined;
}): ReactNode {
  const text = useCopyText();
  const place = props.place;
  if (place === undefined) return null;
  const tone = landingQueuePlaceTone(place);
  const words = text(landingQueuePlaceWords(place));
  const chip = (
    <span
      className={`${pillLookClassName({ tone })} landing-queue-chip`}
      role="img"
      aria-label={words}
      title={props.inLink === true ? words : undefined}
      data-holding={place.holding || undefined}
    >
      <TicketRunMarkDrawn mark="Merge" tone={tone} />
      <span aria-hidden="true">{text(landingQueuePlaceFigure(place))}</span>
    </span>
  );
  return props.inLink === true ? chip : <Tooltip text={words}>{chip}</Tooltip>;
}
