/**
 * One session's transcript walk, and the note a lead leaves a successor with
 * nothing else to read yet.
 *
 * The walk asks for the batches above the one it has read to, and it does so
 * when the batch count on the session's own read rises — a turn moving is what
 * raises it, so there is no poll here and no follow control. The cursors below
 * the mark are read ahead of the walk and taken as it reaches them, so what is
 * folded is the same sequential walk over answers that were asked for at once.
 * Every entry is drawn as characters and nothing in a transcript is a link.
 *
 * NOTHING IS DRAWN UNTIL THE WALK OVER A STREAM HAS SETTLED ONCE — reached the
 * mark, stalled, failed, or found no stream to read — because a page stepped in
 * as it lands paints the first turn and then repaints for every page behind it,
 * with the scroller chasing the bottom. From that settle on each page is
 * published as it is folded, so a session still answering appends.
 *
 * ONE WALK SERVES THE LEAD AND A MEMBER THREAD. The two routes answer the same
 * page over the same store — the contract aliases the thread's response to the
 * lead's — so a second copy of this walk would be two accounts of one chain,
 * and the compaction discipline is exactly the part that must not be re-derived.
 * What a caller chooses is the session; everything below is the same.
 *
 * THE SESSION IS A VALUE AND NOT A READER FUNCTION, so that what the walk's
 * effect depends on stays a string: a caller handing it a fresh closure each
 * render would re-run the walk every render, which is a read loop rather than a
 * live page.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { sessionStorePageBatchesMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { LeadTranscriptResponse } from "../../../../../src/contract/responses.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  apiLeadTranscript,
  apiThreadTranscript,
} from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  leadTranscriptCursorsFrom,
  leadTranscriptDrawn,
  leadTranscriptNextAfter,
  leadTranscriptPaneEmpty,
  leadTranscriptStep,
} from "../../core/leadTranscript.ts";
import type {
  LeadHandoffNote,
  LeadTranscriptEvent,
  LeadTranscriptHeld,
  LeadTranscriptPane,
} from "../../core/leadTranscript.ts";
import { useApiPorts } from "../api.ts";
import { ConversationCard } from "../conversation/ConversationCard.tsx";
import { Pill } from "../ui/Pill.tsx";

export interface LeadTranscriptRead {
  readonly partition: PartitionIdentity;
  /** The member thread whose store is walked, and nothing for the project's
   * own lead. */
  readonly session?: string | undefined;
  readonly stream: string | undefined;
  readonly highWaterBatch: number;
}

/** What a page draws of one walk: the pane as it stands, and whether the walk
 * over the stream it was given has still to settle. */
export interface LeadTranscriptWalk {
  readonly held: LeadTranscriptHeld;
  readonly reading: boolean;
}

/** What is drawn, and the stream the walk behind it has settled over — nothing
 * until one has. */
interface LeadTranscriptDrawn {
  readonly held: LeadTranscriptHeld;
  readonly settled: { readonly stream: string | undefined } | undefined;
}

function leadTranscriptSettledOn(
  drawn: LeadTranscriptDrawn,
  stream: string | undefined,
): boolean {
  return drawn.settled !== undefined && drawn.settled.stream === stream;
}

/** The reads one walk keeps in flight, by the cursor each was asked with, so a
 * cursor the walk reaches has its answer already on the way. */
function leadTranscriptReads(
  ports: ApiPorts,
  at: {
    readonly partition: PartitionIdentity;
    readonly session: string | undefined;
    readonly stream: string;
  },
): {
  readonly asked: (after: number) => Promise<ApiResult<LeadTranscriptResponse>>;
  readonly taken: (after: number) => void;
  readonly dropped: () => void;
} {
  const inFlight = new Map<
    number,
    Promise<ApiResult<LeadTranscriptResponse>>
  >();
  return {
    asked: (after) => {
      const started = inFlight.get(after);
      if (started !== undefined) return started;
      const page = {
        stream: at.stream,
        after,
        limit: sessionStorePageBatchesMax,
      };
      const asking =
        at.session === undefined
          ? apiLeadTranscript(ports, at.partition, page)
          : apiThreadTranscript(ports, at.partition, at.session, page);
      inFlight.set(after, asking);
      return asking;
    },
    taken: (after) => {
      inFlight.delete(after);
    },
    dropped: () => {
      inFlight.clear();
    },
  };
}

/**
 * The batches between what is held and the mark the session's own read carries,
 * however many pages that takes, abandoned when the page goes away. THE PANE IS
 * THE STATE AND WHAT IS DRAWN IS DERIVED FROM IT: this reads, turns each read
 * into one of the events the pane accepts, and holds nothing of its own — every
 * decision about what a reader sees is `leadTranscriptStep`'s and
 * `leadTranscriptDrawn`'s.
 */
export function useLeadTranscript(
  read: LeadTranscriptRead,
): LeadTranscriptWalk {
  const ports = useApiPorts();
  const pane = useRef<LeadTranscriptPane>(leadTranscriptPaneEmpty);
  const unmounted = useRef(false);
  useEffect(
    () => () => {
      unmounted.current = true;
    },
    [],
  );
  const [drawn, setDrawn] = useState<LeadTranscriptDrawn>({
    held: leadTranscriptDrawn(leadTranscriptPaneEmpty),
    settled: undefined,
  });
  const { session, stream, highWaterBatch } = read;
  const { tenant, project } = read.partition;
  useEffect(() => {
    let superseded = false;
    /** However the walk ended: a throw would leave the page reading forever. */
    const settle = (): void => {
      if (superseded || unmounted.current) return;
      setDrawn({
        held: leadTranscriptDrawn(pane.current),
        settled: { stream },
      });
    };
    const stepped = (event: LeadTranscriptEvent): void => {
      pane.current = leadTranscriptStep(pane.current, event);
      if (unmounted.current) return;
      setDrawn((was) =>
        leadTranscriptSettledOn(was, stream)
          ? { held: leadTranscriptDrawn(pane.current), settled: was.settled }
          : was,
      );
    };
    const walk = async (): Promise<void> => {
      if (pane.current.stream !== undefined && pane.current.stream !== stream)
        stepped({ event: "StreamChange", stream });
      if (stream === undefined) return;
      const reads = leadTranscriptReads(ports, {
        partition: { tenant, project },
        session,
        stream,
      });
      for (let read = 0; read < highWaterBatch; read += 1) {
        const after = leadTranscriptNextAfter(pane.current, highWaterBatch);
        if (after === undefined || superseded) return;
        for (const cursor of leadTranscriptCursorsFrom(after, highWaterBatch))
          void reads.asked(cursor);
        const answered = await reads.asked(after);
        reads.taken(after);
        if (answered.outcome !== "Ok") {
          stepped({ event: "Failure", reason: panelReason(answered) });
          return;
        }
        stepped({ event: "Page", page: answered.value, highWaterBatch });
        /** A reset sends the cursor back to nothing, and everything read ahead
         * of it was read under the cut this pane has just abandoned. */
        if (pane.current.fold.readTo === undefined) reads.dropped();
        if (superseded) return;
      }
    };
    void walk().then(settle, settle);
    return () => {
      superseded = true;
    };
  }, [ports, tenant, project, session, stream, highWaterBatch]);
  return { held: drawn.held, reading: !leadTranscriptSettledOn(drawn, stream) };
}

/** The note a lead leaves a successor that has no transcript, as much of it as
 * the lead read carries. */
export function LeadNote(props: {
  readonly note: LeadHandoffNote | undefined;
}): ReactNode {
  const note = props.note;
  if (note === undefined || note.bytes === 0) return null;
  return (
    <div className="max-w-page mx-auto w-full px-4 pt-4">
      <ConversationCard
        label={
          <span className="flex flex-wrap items-center gap-2">
            <span>Handoff note</span>
            <span className="text-ink-3 tabular-nums">{note.bytes}</span>
            {note.truncated ? <Pill tone="parked">Truncated</Pill> : null}
          </span>
        }
      >
        <pre className="max-h-(--height-clip) overflow-auto">
          {note.preview}
        </pre>
      </ConversationCard>
    </div>
  );
}
