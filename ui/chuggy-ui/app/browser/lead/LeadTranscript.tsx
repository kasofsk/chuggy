/**
 * One session's transcript walk, and the note a lead leaves a successor with
 * nothing else to read yet.
 *
 * The walk asks for the batches above the one it has read to, and it does so
 * when the batch count on the session's own read rises — a turn moving is what
 * raises it, so there is no poll here and no follow control. Every entry is
 * drawn as characters and nothing in a transcript is a link.
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

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  apiLeadTranscript,
  apiThreadTranscript,
} from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  leadTranscriptDrawn,
  leadTranscriptNextAfter,
  leadTranscriptPaneEmpty,
  leadTranscriptReadsMax,
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

/**
 * The batches above what is held, a bounded number of pages at a time,
 * abandoned when the page goes away. THE PANE IS THE STATE AND WHAT IS DRAWN IS
 * DERIVED FROM IT: this reads, turns each read into one of the events the pane
 * accepts, and holds nothing of its own — every decision about what a reader
 * sees is `leadTranscriptStep`'s and `leadTranscriptDrawn`'s.
 */
export function useLeadTranscript(
  read: LeadTranscriptRead,
): LeadTranscriptHeld {
  const ports = useApiPorts();
  const pane = useRef<LeadTranscriptPane>(leadTranscriptPaneEmpty);
  /** Set only by unmount's own cleanup, so a walk's cleanup can tell that from
   * a dependency of its effect moving — the reason `setHeld` must not follow. */
  const mounted = useRef(true);
  const [held, setHeld] = useState<LeadTranscriptHeld>(
    leadTranscriptDrawn(leadTranscriptPaneEmpty),
  );
  const { session, stream, highWaterBatch } = read;
  const { tenant, project } = read.partition;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    let abandoned = false;
    const stepped = (event: LeadTranscriptEvent): void => {
      pane.current = leadTranscriptStep(pane.current, event);
      if (mounted.current) setHeld(leadTranscriptDrawn(pane.current));
    };
    const walk = async (): Promise<void> => {
      if (pane.current.stream !== undefined && pane.current.stream !== stream)
        stepped({ event: "StreamChange", stream });
      for (let asked = 0; asked < leadTranscriptReadsMax; asked += 1) {
        if (abandoned) return;
        const after = leadTranscriptNextAfter(pane.current, highWaterBatch);
        if (after === undefined || stream === undefined) return;
        const answered =
          session === undefined
            ? await apiLeadTranscript(
                ports,
                { tenant, project },
                {
                  stream,
                  after,
                },
              )
            : await apiThreadTranscript(ports, { tenant, project }, session, {
                stream,
                after,
              });
        if (answered.outcome !== "Ok") {
          if (!abandoned)
            stepped({ event: "Failure", reason: panelReason(answered) });
          return;
        }
        stepped({ event: "Page", page: answered.value, highWaterBatch });
      }
      if (!abandoned) stepped({ event: "BudgetEnd" });
    };
    void walk();
    return () => {
      abandoned = true;
    };
  }, [ports, tenant, project, session, stream, highWaterBatch]);
  return held;
}

/** The note a lead leaves a successor that has no transcript, as much of it as
 * the lead read carries. */
export function LeadNote(props: {
  readonly note: LeadHandoffNote | undefined;
}): ReactNode {
  const note = props.note;
  if (note === undefined || note.bytes === 0) return null;
  return (
    <div className="pb-3">
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
