/**
 * The lead's transcript, in two readings of one list: what it currently holds,
 * and the whole chain with the seam the last compaction cut at.
 *
 * The walk asks for the batches above the one it has read to, and it does so
 * when the batch count on the lead read rises — that read is the `Session`
 * frame's own body, so there is no poll here and no follow control. Every entry
 * is drawn as characters and nothing in a transcript is a link.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiLeadTranscript } from "../../core/apiRoutes.ts";
import { instantFigure } from "../../core/figures.ts";
import { panelReason } from "../../core/freshness.ts";
import {
  leadTranscriptDrawn,
  leadTranscriptFailed,
  leadTranscriptHeldEmpty,
  leadTranscriptHolding,
  leadTranscriptLines,
  leadTranscriptMerged,
  leadTranscriptNextAfter,
  leadTranscriptReadsMax,
} from "../../core/leadTranscript.ts";
import type {
  LeadHandoffNote,
  LeadTranscriptHeld,
  LeadTranscriptLine,
} from "../../core/leadTranscript.ts";
import { useApiPorts } from "../api.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Ledger, LedgerBlock, LedgerRow } from "../ui/Ledger.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";

export interface LeadTranscriptRead {
  readonly partition: PartitionIdentity;
  readonly stream: string | undefined;
  readonly highWaterBatch: number;
}

/**
 * The batches above what is held, a bounded number of pages at a time,
 * abandoned when the page goes away. WHAT THE WALK HOLDS AND WHAT IS DRAWN ARE
 * TWO VALUES: a moved cut empties the first so the cursor goes back to the
 * start of the stream, and `leadTranscriptDrawn` is what keeps that step from
 * reaching a reader as a lead that has recorded nothing.
 */
export function useLeadTranscript(
  read: LeadTranscriptRead,
): LeadTranscriptHeld {
  const ports = useApiPorts();
  const [held, setHeld] = useState<LeadTranscriptHeld>(leadTranscriptHeldEmpty);
  const holding = useRef<LeadTranscriptHeld>(leadTranscriptHeldEmpty);
  const { stream, highWaterBatch } = read;
  const { tenant, project } = read.partition;
  useEffect(() => {
    let abandoned = false;
    const walk = async (): Promise<void> => {
      if (
        holding.current.stream !== undefined &&
        holding.current.stream !== stream
      ) {
        holding.current = leadTranscriptHeldEmpty;
        setHeld(leadTranscriptHeldEmpty);
      }
      for (let page = 0; page < leadTranscriptReadsMax; page += 1) {
        const after = leadTranscriptNextAfter(holding.current, highWaterBatch);
        if (after === undefined || stream === undefined || abandoned) return;
        const answered = await apiLeadTranscript(
          ports,
          { tenant, project },
          { stream, after },
        );
        if (abandoned) return;
        const next =
          answered.outcome === "Ok"
            ? leadTranscriptMerged(
                holding.current,
                answered.value,
                highWaterBatch,
              )
            : leadTranscriptFailed(holding.current, panelReason(answered));
        holding.current = next;
        setHeld((drawn) => leadTranscriptDrawn(drawn, next));
        if (answered.outcome !== "Ok") return;
      }
    };
    void walk();
    return () => {
      abandoned = true;
    };
  }, [ports, tenant, project, stream, highWaterBatch]);
  return held;
}

/** What one read could not draw, as the one line each is worth. */
function LeadTranscriptNotes(props: {
  readonly held: LeadTranscriptHeld;
}): ReactNode {
  const held = props.held;
  return (
    <>
      {held.failure === undefined ? null : (
        <Notice tone="danger" inline detail={`Failed · ${held.failure}`} />
      )}
      {held.truncated ? (
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
 * are said as themselves, in the same words the Log says them in — a lead with
 * no store, a stream the store's listing does not carry, and a read the route
 * could not decide the held set for — because "nothing held" beside a lead that
 * has plainly been deciding is a claim none of them makes.
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
      ) : props.held.holdingUnknown && lines.length === 0 ? (
        <EmptyState label="Undecided" />
      ) : lines.length === 0 ? (
        <EmptyState label="Nothing held" />
      ) : (
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
 * lead kept of it. A reference the store's own listing does not carry is said
 * as itself: nothing can be read for it, and drawing that as an empty log would
 * be indistinguishable from a lead that has recorded nothing.
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
      ) : lines.length === 0 ? (
        <EmptyState label="No entries" />
      ) : (
        <ol className="lead-log">
          {lines.map((line) => (
            <LeadLogLine key={line.ordinal} line={line} />
          ))}
        </ol>
      )}
    </Panel>
  );
}
