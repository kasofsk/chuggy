/**
 * The session adapter of the Context view: the lead's panel at the head of its
 * details, and the panel a thread's page opens beside its conversation.
 *
 * Each is drawn from the session's readings and the transcript its page is
 * already walking, and its readings are read again only when the session's own
 * read names a newer turn or a turn that moved, so nothing here is polled.
 */

import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  LeadResponse,
  SessionContextResponse,
  ThreadResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  leadContextQuery,
  threadContextQuery,
} from "../../core/contextQueries.ts";
import {
  contextSessionInputsOf,
  contextSessionMarkOf,
  contextSessionOf,
  contextThreadSeedOf,
} from "../../core/contextSession.ts";
import type { PanelState } from "../../core/freshness.ts";
import type { LeadTranscriptHeld } from "../../core/leadTranscript.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import { usePanelState } from "../api.ts";
import { DataPanel, PanelUnready } from "../DataPanel.tsx";
import { ChatPaneIconButton } from "../shell/chatPaneIcons.tsx";
import { Button } from "../ui/Button.tsx";
import { ContextSessionView } from "./ContextView.tsx";

/** A session's panel from its readings, where it has any, and what its
 * transcript holds. */
function SessionContextDrawn(props: {
  readonly context: SessionContextResponse | undefined;
  readonly held: LeadTranscriptHeld;
  readonly seed: string | undefined;
}): ReactNode {
  const view = contextSessionOf({
    context: props.context,
    entries: props.held.entries,
    cuts: props.held.compactions,
  });
  return (
    <ContextSessionView
      drawn={{
        ...view,
        inputs: contextSessionInputsOf(props.context, props.seed, view.window),
      }}
    />
  );
}

/** The lead's Context panel, the first of its details. */
export function LeadContextPanel(props: {
  readonly partition: PartitionIdentity;
  readonly lead: LeadResponse | undefined;
  readonly held: LeadTranscriptHeld;
}): ReactNode {
  const text = useCopyText();
  const state = usePanelState({
    ...leadContextQuery(
      props.partition,
      contextSessionMarkOf(props.lead?.turns ?? []),
    ),
    enabled: props.lead !== undefined,
    placeholderData: keepPreviousData,
  });
  return (
    <DataPanel title={text({ id: "context-title" })} state={state}>
      {(context) => (
        <SessionContextDrawn
          context={context}
          held={props.held}
          seed={undefined}
        />
      )}
    </DataPanel>
  );
}

/** A thread's panel once its readings have answered, or failed to: a failed
 * read still draws what the transcript says. */
function ThreadContextBody(props: {
  readonly state: PanelState<SessionContextResponse>;
  readonly held: LeadTranscriptHeld;
  readonly seed: string | undefined;
}): ReactNode {
  const { state } = props;
  if (state.state === "Pending") return <PanelUnready state={state} />;
  return (
    <SessionContextDrawn
      context={state.state === "Ready" ? state.value : undefined}
      held={props.held}
      seed={props.seed}
    />
  );
}

/** A thread bar's Context, pressed while its panel is open. */
export function ContextToggle(props: {
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Button
      size="sm"
      variant={props.open ? "primary" : "default"}
      pressed={props.open}
      onClick={() => {
        props.onToggle(!props.open);
      }}
    >
      {text({ id: "context-open" })}
    </Button>
  );
}

/** A thread's Context panel, beside its conversation until it is closed. */
export function ThreadContextPanel(props: {
  readonly home: ThreadHome;
  readonly thread: ThreadResponse;
  readonly held: LeadTranscriptHeld;
  readonly onClose: () => void;
}): ReactNode {
  const text = useCopyText();
  const { thread } = props;
  const state = usePanelState({
    ...threadContextQuery(
      props.home,
      thread.session,
      contextSessionMarkOf(thread.turns),
    ),
    placeholderData: keepPreviousData,
  });
  return (
    <aside className="context-panel" aria-label={text({ id: "context-title" })}>
      <header className="context-panel-head">
        <h2 className="context-panel-title">{text({ id: "context-title" })}</h2>
        <ChatPaneIconButton
          glyph="close"
          label={text({ id: "context-close" })}
          onClick={props.onClose}
        />
      </header>
      <div className="context-panel-body">
        <ThreadContextBody
          state={state}
          held={props.held}
          seed={contextThreadSeedOf(thread.turns)}
        />
      </div>
    </aside>
  );
}
