/**
 * The epic page's History tab: its revisions, newest first, a page at a
 * time, the newest read by the layout and each older one once it is asked
 * for. Each row says its revision, what changed and who changed it, and when;
 * a run of one actor's small edits is one row, each of its revisions listed
 * under it on asking.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { EpicHistoryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  epicActorLabel,
  epicHistoryRowSaid,
  epicHistoryRows,
  epicRevisionSaid,
} from "../../core/epicHistory.ts";
import type { EpicHistoryRow } from "../../core/epicHistory.ts";
import { epicHistoryQuery } from "../../core/epics.ts";
import { instantFigure, instantSpanFigure } from "../../core/figures.ts";
import type { Label } from "../../core/labels.ts";
import type { PanelState } from "../../core/freshness.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicHistory.css";

/** Who made a revision, as data: a name is not the catalog's to word. */
export function EpicActor(props: { readonly label: Label }): ReactNode {
  return (
    <Tooltip text={props.label.title}>
      <span translate="no">{props.label.text}</span>
    </Tooltip>
  );
}

/** A folded run's revisions, each on its own line, shown on asking. */
function EpicHistoryEach(props: { readonly row: EpicHistoryRow }): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      look={{ variant: "quiet", size: "sm" }}
      chevron
      label={text({ id: "epics-history-show-each" })}
    >
      <ol className="epic-history-each">
        {props.row.map((revision) => (
          <li key={revision.revision}>
            {text({
              id: "epics-history-each",
              args: {
                revision: String(revision.revision),
                change: epicRevisionSaid(revision),
              },
            })}
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

function EpicHistoryRowDrawn(props: {
  readonly row: EpicHistoryRow;
  readonly held: EpicPageHeld;
}): ReactNode {
  const text = useCopyText();
  const { row, held } = props;
  const newest = row[0];
  const oldest = row.at(-1) ?? newest;
  const folded = row.length > 1;
  return (
    <li className="epic-history-row">
      <span className="epic-history-revision">
        {folded
          ? text({
              id: "epics-history-revisions",
              args: {
                from: String(oldest.revision),
                to: String(newest.revision),
              },
            })
          : text({
              id: "epics-revision",
              args: { revision: String(newest.revision) },
            })}
      </span>
      <div className="epic-history-body">
        <span className="epic-history-said">
          {text(epicHistoryRowSaid(row))}
        </span>
        <span className="epic-history-who">
          <EpicActor label={epicActorLabel(newest.actor, held.creatorEmails)} />
          {folded ? (
            <>
              {" · "}
              <span className="epic-history-count">
                {text({
                  id: "epics-history-count",
                  args: { count: row.length },
                })}
              </span>
            </>
          ) : null}
        </span>
        {folded ? <EpicHistoryEach row={row} /> : null}
      </div>
      <span className="epic-history-when">
        <Figure
          figure={
            folded
              ? instantSpanFigure(
                  oldest.changedAt,
                  newest.changedAt,
                  held.nowMs,
                )
              : instantFigure(newest.changedAt, held.nowMs)
          }
        />
      </span>
    </li>
  );
}

/** One page of the revisions, and under it the older one once it is asked for. */
function EpicHistoryPage(props: {
  readonly state: PanelState<EpicHistoryResponse>;
  readonly held: EpicPageHeld;
}): ReactNode {
  const text = useCopyText();
  const [older, setOlder] = useState(false);
  const state = props.state;
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const { revisions, nextAfter } = state.value;
  return (
    <>
      <ol
        className="epic-history"
        aria-label={text({ id: "epics-revisions-label" })}
      >
        {epicHistoryRows(revisions).map((row) => (
          <EpicHistoryRowDrawn
            key={row[0].revision}
            row={row}
            held={props.held}
          />
        ))}
      </ol>
      {nextAfter === undefined ? null : older ? (
        <EpicHistoryOlder held={props.held} after={nextAfter} />
      ) : (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setOlder(true);
            }}
          >
            {text({ id: "epics-show-older" })}
          </Button>
        </div>
      )}
    </>
  );
}

/** A page older than the newest, read once the reader asks for it. */
function EpicHistoryOlder(props: {
  readonly held: EpicPageHeld;
  readonly after: number;
}): ReactNode {
  const state = usePanelState(
    epicHistoryQuery(props.held.partition, props.held.epic, props.after),
  );
  return <EpicHistoryPage state={state} held={props.held} />;
}

export function EpicHistoryTab(): ReactNode {
  const held = useEpicPageHeld();
  return (
    <section className="epic-history-tab">
      <EpicHistoryPage state={held.historyState} held={held} />
    </section>
  );
}
