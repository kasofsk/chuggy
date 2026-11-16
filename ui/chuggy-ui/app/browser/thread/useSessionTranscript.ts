/**
 * One session's transcript walk.
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
 * `OF` IS A VALUE AND NOT A READER FUNCTION, so that what the walk's effect
 * depends on stays a string, `of` named as one: a caller handing it a fresh
 * closure each render would re-run the walk every render, which is a read loop
 * rather than a live page.
 */

import { useEffect, useRef, useState } from "react";

import { sessionStorePageBatchesMax } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { LeadTranscriptResponse } from "../../../../../src/contract/responses.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import { apiLeadTranscript } from "../../core/apiRoutes.ts";
import {
  sessionTranscriptCursorsFrom,
  sessionTranscriptDrawn,
  sessionTranscriptNextAfter,
  sessionTranscriptPaneEmpty,
  sessionTranscriptStep,
} from "../../core/sessionTranscript.ts";
import type {
  SessionTranscriptEvent,
  SessionTranscriptHeld,
  SessionTranscriptPane,
} from "../../core/sessionTranscript.ts";
import { apiThreadTranscriptAt } from "../../core/threadHome.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import { useApiPorts } from "../api.ts";

/** Whose store is walked: a project's own lead, or one member thread wherever
 * it is kept. */
export type SessionTranscriptOf =
  | { readonly lead: PartitionIdentity }
  | { readonly thread: string; readonly home: ThreadHome };

export interface SessionTranscriptRead {
  readonly of: SessionTranscriptOf;
  readonly stream: string | undefined;
  readonly highWaterBatch: number;
}

/** What a page draws of one walk: the pane as it stands, and whether the walk
 * over the stream it was given has still to settle. */
export interface SessionTranscriptWalk {
  readonly held: SessionTranscriptHeld;
  readonly reading: boolean;
}

/** What is drawn, and the stream the walk behind it has settled over — nothing
 * until one has. */
interface SessionTranscriptDrawn {
  readonly held: SessionTranscriptHeld;
  readonly settled: { readonly stream: string | undefined } | undefined;
}

function sessionTranscriptSettledOn(
  drawn: SessionTranscriptDrawn,
  stream: string | undefined,
): boolean {
  return drawn.settled !== undefined && drawn.settled.stream === stream;
}

/** The reads one walk keeps in flight, by the cursor each was asked with, so a
 * cursor the walk reaches has its answer already on the way. */
function sessionTranscriptReads(
  ports: ApiPorts,
  at: { readonly of: SessionTranscriptOf; readonly stream: string },
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
      const { of } = at;
      const asking =
        "lead" in of
          ? apiLeadTranscript(ports, of.lead, page)
          : apiThreadTranscriptAt(ports, of.home, of.thread, page);
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

/** Whether the page holding the walk has gone away, which a read answering
 * after it must not draw into. */
function useSessionTranscriptUnmounted(): { readonly current: boolean } {
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);
  return unmounted;
}

/**
 * The batches between what is held and the mark the session's own read carries,
 * however many pages that takes, abandoned when the page goes away. THE PANE IS
 * THE STATE AND WHAT IS DRAWN IS DERIVED FROM IT: this reads, turns each read
 * into one of the events the pane accepts, and holds nothing of its own — every
 * decision about what a reader sees is `sessionTranscriptStep`'s and
 * `sessionTranscriptDrawn`'s.
 */
export function useSessionTranscript(
  read: SessionTranscriptRead,
): SessionTranscriptWalk {
  const ports = useApiPorts();
  const pane = useRef<SessionTranscriptPane>(sessionTranscriptPaneEmpty);
  const unmounted = useSessionTranscriptUnmounted();
  const [drawn, setDrawn] = useState<SessionTranscriptDrawn>({
    held: sessionTranscriptDrawn(sessionTranscriptPaneEmpty),
    settled: undefined,
  });
  const { stream, highWaterBatch } = read;
  const of = JSON.stringify(read.of);
  useEffect(() => {
    let superseded = false;
    /** However the walk ended: a throw would leave the page reading forever. */
    const settle = (): void => {
      if (superseded || unmounted.current) return;
      setDrawn({
        held: sessionTranscriptDrawn(pane.current),
        settled: { stream },
      });
    };
    const stepped = (event: SessionTranscriptEvent): void => {
      pane.current = sessionTranscriptStep(pane.current, event);
      if (unmounted.current) return;
      setDrawn((was) =>
        sessionTranscriptSettledOn(was, stream)
          ? { held: sessionTranscriptDrawn(pane.current), settled: was.settled }
          : was,
      );
    };
    const walk = async (): Promise<void> => {
      if (pane.current.stream !== undefined && pane.current.stream !== stream)
        stepped({ event: "StreamChange", stream });
      if (stream === undefined) return;
      const reads = sessionTranscriptReads(ports, {
        of: JSON.parse(of) as SessionTranscriptOf,
        stream,
      });
      for (let read = 0; read < highWaterBatch; read += 1) {
        const after = sessionTranscriptNextAfter(pane.current, highWaterBatch);
        if (after === undefined || superseded) return;
        for (const cursor of sessionTranscriptCursorsFrom(
          after,
          highWaterBatch,
        ))
          void reads.asked(cursor);
        const answered = await reads.asked(after);
        reads.taken(after);
        if (answered.outcome !== "Ok") {
          stepped({ event: "Failure", failure: answered });
          return;
        }
        stepped({ event: "Page", page: answered.value, highWaterBatch, after });
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
  }, [ports, of, stream, highWaterBatch, unmounted]);
  return {
    held: drawn.held,
    reading: !sessionTranscriptSettledOn(drawn, stream),
  };
}
