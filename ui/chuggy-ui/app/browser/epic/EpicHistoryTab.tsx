/**
 * The epic page's History tab: its revisions, newest first, a page at a
 * time, the newest read by the layout and each older one once it is asked
 * for.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { EpicHistoryResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { epicHistoryQuery } from "../../core/epics.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Button } from "../ui/Button.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Panel } from "../ui/Panel.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";
import type { EpicPageHeld } from "./EpicPageHeld.tsx";

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
        className="grid gap-1 text-sm"
        aria-label={text({ id: "epics-revisions-label" })}
      >
        {revisions.map((revision) => (
          <li key={revision.revision} className="flex flex-wrap gap-2">
            <span>
              {text({
                id: "epics-revision",
                args: { revision: String(revision.revision) },
              })}
            </span>
            <span>{revision.title}</span>
            <span className="text-ink-3">{revision.actor.subject}</span>
            <Figure
              figure={instantFigure(revision.changedAt, props.held.nowMs)}
            />
          </li>
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
  const text = useCopyText();
  return (
    <Panel title={text({ id: "epics-history" })}>
      <EpicHistoryPage state={held.historyState} held={held} />
    </Panel>
  );
}
