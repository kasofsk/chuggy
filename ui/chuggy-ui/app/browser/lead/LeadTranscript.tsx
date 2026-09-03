/**
 * One session's transcript, in two readings of one list: what it currently
 * holds, and the whole chain with the seam the last compaction cut at.
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
import { instantFigure } from "../../core/figures.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  leadTranscriptDrawn,
  leadTranscriptHolding,
  leadTranscriptLines,
  leadTranscriptNextAfter,
  leadTranscriptPaneEmpty,
  leadTranscriptReadsMax,
  leadTranscriptStep,
} from "../../core/leadTranscript.ts";
import type {
  LeadHandoffNote,
  LeadTranscriptEvent,
  LeadTranscriptHeld,
  LeadTranscriptLine,
  LeadTranscriptPane,
} from "../../core/leadTranscript.ts";
import { useApiPorts } from "../api.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Ledger, LedgerBlock, LedgerRow } from "../ui/Ledger.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
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
  const [held, setHeld] = useState<LeadTranscriptHeld>(
    leadTranscriptDrawn(leadTranscriptPaneEmpty),
  );
  const { session, stream, highWaterBatch } = read;
  const { tenant, project } = read.partition;
  useEffect(() => {
    let abandoned = false;
    const stepped = (event: LeadTranscriptEvent): void => {
      pane.current = leadTranscriptStep(pane.current, event);
      setHeld(leadTranscriptDrawn(pane.current));
    };
    const walk = async (): Promise<void> => {
      if (pane.current.stream !== undefined && pane.current.stream !== stream)
        stepped({ event: "StreamChange", stream });
      for (let asked = 0; asked < leadTranscriptReadsMax; asked += 1) {
        const after = leadTranscriptNextAfter(pane.current, highWaterBatch);
        if (after === undefined || stream === undefined || abandoned) return;
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
        if (abandoned) return;
        if (answered.outcome !== "Ok") {
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

/**
 * The one word for a pane that cannot say what it has not reached — a walk
 * waiting at a stalled cursor, or a read the route could not decide the held
 * set for — drawn by both panels, because a range one of them calls unreached
 * and the other draws as an empty log is two accounts of one state.
 *
 * IT REPLACES WHAT IS NOT THERE AND SITS BESIDE WHAT IS: a panel with nothing
 * drawn has no empty state but this one, while a panel with entries keeps them
 * and takes the word beside them.
 */
function LeadUndecided(props: { readonly drawn: number }): ReactNode {
  if (props.drawn === 0) return <EmptyState label="Undecided" />;
  return <Notice tone="parked" inline detail="Undecided" />;
}

/**
 * What one read could not draw, as the one line each is worth. A read that could
 * not decide the held set is truncated by construction, so `Undecided` is what
 * that one fact is said in and `Truncated` stands only where it is the whole of
 * what went short.
 */
function LeadTranscriptNotes(props: {
  readonly held: LeadTranscriptHeld;
}): ReactNode {
  const held = props.held;
  return (
    <>
      {held.failure === undefined ? null : (
        <Notice tone="danger" inline detail={`Failed · ${held.failure}`} />
      )}
      {held.truncated && !held.holdingUnknown ? (
        <Notice tone="parked" inline detail="Truncated" />
      ) : null}
      {held.elided === 0 ? null : (
        <Notice
          tone="parked"
          inline
          detail={`Elided · ${String(held.elided)}`}
        />
      )}
      {held.entriesDropped === 0 ? null : (
        <Notice
          tone="parked"
          inline
          detail={`Dropped · ${String(held.entriesDropped)}`}
        />
      )}
    </>
  );
}

/** What an open row is remembered by. The ordinal is a position in what the
 * pane holds, so once the oldest entries leave at the cap it names a different
 * entry; the uuid is the entry itself wherever the store gave one. */
function leadLineKey(line: LeadTranscriptLine): string {
  return line.uuid ?? `ordinal-${String(line.ordinal)}`;
}

function LeadEntryRow(props: {
  readonly line: LeadTranscriptLine;
  readonly nowMs: number;
  readonly open: string | undefined;
  readonly onToggle: (line: LeadTranscriptLine) => void;
}): ReactNode {
  const line = props.line;
  const named = leadLineKey(line);
  return (
    <LedgerRow
      label={`Entry ${String(line.ordinal)}`}
      pill={{ tone: "neutral", text: line.type }}
      {...(line.at === undefined
        ? {}
        : { when: instantFigure(line.at, props.nowMs) })}
      note={line.tools.join(", ")}
      expand={{
        open: props.open === named,
        onToggle: () => {
          props.onToggle(line);
        },
        children: <pre className="lead-entry-text">{line.text}</pre>,
      }}
    />
  );
}

/** The note a lead leaves a successor that has no transcript, as much of it as
 * the lead read carries. */
function LeadNote(props: {
  readonly note: LeadHandoffNote | undefined;
}): ReactNode {
  const note = props.note;
  if (note === undefined || note.bytes === 0) return null;
  return (
    <div className="lead-note-held">
      <p className="lead-note-head">
        <span className="eyebrow">Handoff note</span>
        <span className="num">{note.bytes}</span>
        {note.truncated ? <Pill tone="parked">Truncated</Pill> : null}
      </p>
      <pre className="lead-entry-text">{note.preview}</pre>
    </div>
  );
}

/**
 * What the lead is working from: the note it left itself and the chain from the
 * last seam on, one block per entry. Three things that are not an empty context
 * are said as themselves, IN THE SAME WORDS THE LOG SAYS THEM IN — a lead with
 * no store, a stream the store's listing does not carry, and a range this pane
 * has not reached — because "nothing held" beside a lead that has plainly been
 * deciding is a claim none of them makes, and one panel calling a range
 * unreached while the other draws it as an empty log is two accounts of one
 * state.
 */
export function LeadHolding(props: {
  readonly held: LeadTranscriptHeld;
  readonly note: LeadHandoffNote | undefined;
  readonly stream: string | undefined;
  readonly listed: boolean;
  readonly nowMs: number;
}): ReactNode {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const lines = leadTranscriptHolding(props.held);
  return (
    <Panel title="Holding">
      <LeadNote note={props.note} />
      {props.stream === undefined ? (
        <EmptyState label="No store" />
      ) : !props.listed ? (
        <EmptyState label="Stream unlisted" />
      ) : props.held.holdingUnknown ? (
        <LeadUndecided drawn={lines.length} />
      ) : lines.length === 0 ? (
        <EmptyState label="Nothing held" />
      ) : null}
      {props.stream === undefined ||
      !props.listed ||
      lines.length === 0 ? null : (
        <Ledger>
          {lines.map((line) => (
            <LedgerBlock key={leadLineKey(line)}>
              <LeadEntryRow
                line={line}
                nowMs={props.nowMs}
                open={open}
                onToggle={(chosen) => {
                  const named = leadLineKey(chosen);
                  setOpen(open === named ? undefined : named);
                }}
              />
            </LedgerBlock>
          ))}
        </Ledger>
      )}
    </Panel>
  );
}

/** One line of the raw chain, and the seam above the entry a compaction cut at. */
function LeadLogLine(props: { readonly line: LeadTranscriptLine }): ReactNode {
  const line = props.line;
  return (
    <>
      {line.seam ? (
        <li className="lead-seam">
          <span className="eyebrow">Compaction</span>
        </li>
      ) : null}
      <li
        className="lead-line"
        data-holding={line.holding ? "true" : undefined}
      >
        <span className="lead-line-type">{line.type}</span>
        {line.tools.length === 0 ? null : (
          <span className="lead-line-tools">{line.tools.join(", ")}</span>
        )}
        <pre className="lead-entry-text">{line.text}</pre>
      </li>
    </>
  );
}

/**
 * The whole chain this page holds, oldest first, the raw log beside what the
 * lead kept of it. What cannot be read for is said as itself and in the words
 * the Holding panel says it in, because drawing an unreached range as an empty
 * log is indistinguishable from a lead that has recorded nothing.
 */
export function LeadLog(props: {
  readonly held: LeadTranscriptHeld;
  readonly stream: string | undefined;
  readonly listed: boolean;
}): ReactNode {
  const lines = leadTranscriptLines(props.held);
  if (props.stream === undefined)
    return (
      <Panel title="Log">
        <EmptyState label="No store" />
      </Panel>
    );
  return (
    <Panel title="Log">
      <LeadTranscriptNotes held={props.held} />
      {!props.listed ? (
        <EmptyState label="Stream unlisted" />
      ) : props.held.holdingUnknown ? (
        <LeadUndecided drawn={lines.length} />
      ) : lines.length === 0 ? (
        <EmptyState label="No entries" />
      ) : null}
      {props.listed && lines.length > 0 ? (
        <ol className="lead-log">
          {lines.map((line) => (
            <LeadLogLine key={line.ordinal} line={line} />
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}
