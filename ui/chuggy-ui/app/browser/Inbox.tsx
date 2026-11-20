/**
 * The escalation inbox: every ticket that needs a human, newest activity first,
 * grouped by what it asks and each answerable where it stands.
 *
 * The server answers the inbox whole, one entry per ticket, and the shell badge
 * and this screen both take that one read through `useInboxRows`, so the count
 * and the items are one value. What an item ran is the latest execution its
 * entry carries, whatever put the ticket here. What an item offers is the
 * core's decision and what happens after the click is `followOperation`'s, both
 * shared with the ticket page, because a second account of what the machine
 * accepts is a second account that drifts.
 *
 * ANSWERING NEVER TOUCHES THE ITEMS. The follow reports its steps into the item
 * it came from and writes into no entry; the item leaves when the inbox, read
 * again on a frame or a poll, no longer holds it, and focus that went with it
 * moves to where `inboxFocusAfter` says. That is the only account of where a
 * ticket is that a reader can trust. `ui/chuggy-ui/test/inbox.test.tsx` and
 * `ui/chuggy-ui/test/inboxEscalation.test.tsx` hold that.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FocusEvent, ReactNode, RefObject } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  InboxEntryResponse,
  RunnerLoss,
  RunStepFailure,
} from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { apiInbox } from "../core/apiRoutes.ts";
import { inboxQuery } from "../core/ticketQueries.ts";
import {
  escalationKindSentence,
  nativeActionKindSentence,
  operationFailureSentence,
} from "../core/codeSentences.ts";
import {
  phaseLabel,
  runnerLossDetail,
  runnerLossLine,
  runStepLabel,
  usageResumeLine,
} from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  ConsoleWriteProgress,
  ConsoleWriteRefused,
  consoleWriteKey,
} from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import {
  inboxActionLabel,
  inboxAnswerInFlight,
  inboxAnswerRefusal,
  inboxStepDetail,
  inboxStepSentence,
} from "../core/inboxAnswers.ts";
import type { InboxAnswer } from "../core/inboxAnswers.ts";
import {
  inboxFocusAfter,
  inboxGroups,
  inboxGroupsHold,
} from "../core/inboxGroups.ts";
import type {
  InboxFocusTarget,
  InboxGroup,
  InboxGroupKind,
  InboxItem,
} from "../core/inboxGroups.ts";
import {
  inboxEntryPhased,
  inboxPage,
  inboxRowsAfterPage,
  inboxRowsHaveMore,
} from "../core/inboxList.ts";
import type { InboxRows } from "../core/inboxList.ts";
import {
  approvalApproversOf,
  evaluationApprovalsAsked,
} from "../core/evaluationApprovals.ts";
import type { ApprovalAsked } from "../core/evaluationApprovals.ts";
import {
  nativeActionAnswerApproval,
  nativeActionAnswerKey,
  nativeActionsAnswers,
} from "../core/nativeActionAnswers.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import type { ProjectAbilities } from "../core/projectAbilities.ts";
import {
  operationAbandonFailure,
  operationAnswered,
} from "../core/operationFollow.ts";
import type { OperationStep } from "../core/operationFollow.ts";
import { followOperationProgressed } from "../core/operationProgress.ts";
import { projectTableRow } from "../core/projectTableRows.ts";
import type { ProjectTableRow } from "../core/projectTableRows.ts";
import { actionsFor, ticketActionSentence } from "../core/ticketActions.ts";
import type { TicketAction, TicketAttempt } from "../core/ticketActions.ts";
import { panelReadRestarted, useApiPorts, usePanelState } from "./api.ts";
import { useConsoleWrite, useConsoleWriteProgress } from "./consoleWrite.tsx";
import { DataSection, ReadFailed } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { useConsoleDispatch } from "./store.ts";
import type { ConsoleDispatch } from "./store.ts";
import {
  ticketAttemptDroppedAt,
  ticketAttemptPressed,
} from "./ticketAttempts.ts";
import { TicketActivity, TicketRowExecutionCell } from "./TicketCells.tsx";
import {
  ApprovalApproversDrawn,
  TicketApprovals,
} from "./ticket/TicketApprovals.tsx";
import { RepositoryImportRefusedNotice } from "./repositories/RepositoryImportRefused.tsx";
import { Button } from "./ui/Button.tsx";
import { useRunReason } from "./RunEvidence.tsx";
import { ConfirmDialog } from "./ui/ConfirmDialog.tsx";
import { CountBadge } from "./ui/CountBadge.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { RecordList, RecordRow } from "./ui/RecordList.tsx";
import { StatusBadge } from "./ui/StatusBadge.tsx";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy, CopyText } from "../core/copy.ts";

import "./Inbox.css";
import "./DataPanel.css";

export interface InboxRowsHeld {
  readonly panel: PanelState<InboxRows>;
  readonly rows: InboxRows | undefined;
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * The inbox, read under its one key. The badge and the panel take the same
 * value through this, which is what makes the header's claim above true rather
 * than merely intended.
 */
export function useInboxRows(partition: PartitionIdentity): InboxRowsHeld {
  const query = inboxQuery(partition);
  const key = query.queryKey;
  const client = useQueryClient();
  const ports = useApiPorts();
  const [reading, setReading] = useState(false);
  const panel = usePanelState(query);
  const rows = panel.state === "Ready" ? panel.value : undefined;
  const readMore = () => {
    setReading(true);
    void (async () => {
      const answered = await apiInbox(
        ports,
        partition,
        inboxPage(rows?.nextCursor),
      );
      client.setQueryData(key, (previous) =>
        previous === undefined
          ? previous
          : inboxRowsAfterPage(previous, answered),
      );
      panelReadRestarted(client, key);
      setReading(false);
    })();
  };
  return {
    panel,
    rows,
    readMore:
      rows === undefined || !inboxRowsHaveMore(rows) || reading
        ? undefined
        : readMore,
    reading,
  };
}

/** An open action's admitted answers, and the phase's own where none is open. */
function inboxEntryActions(entry: InboxEntryResponse): readonly TicketAction[] {
  if (entry.actions.length > 0) return nativeActionsAnswers(entry.actions);
  const phased = inboxEntryPhased(entry);
  return phased === undefined ? [] : actionsFor(phased);
}

/** What an item offers: every answer its entry admits, the evaluation approvals
 * asking this reader, and the other answers the reader's abilities leave. */
function inboxRowAnswers(
  entry: InboxEntryResponse,
  abilities: ProjectAbilities,
  text: CopyText,
): {
  readonly offered: readonly TicketAction[];
  readonly approvals: readonly ApprovalAsked[];
  readonly actions: readonly TicketAction[];
} {
  const offered = inboxEntryActions(entry);
  return {
    offered,
    approvals: evaluationApprovalsAsked(
      entry.actions,
      undefined,
      undefined,
      text,
    ).filter((asked) => asked.answers.length > 0),
    actions: projectAbilityRefused(abilities, "mutate")
      ? []
      : offered.filter((action) => !nativeActionAnswerApproval(action.action)),
  };
}

/** One answer's button, described by the line in its item that says what it
 * does. */
function InboxActionButton(props: {
  readonly action: TicketAction;
  readonly describedBy: string;
  readonly primary: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Button
      variant={props.primary ? "primary" : "quiet"}
      size="sm"
      disabled={props.busy}
      describedBy={props.describedBy}
      onClick={props.onPress}
    >
      {text(inboxActionLabel(props.action.action))}
    </Button>
  );
}

/** What each answer does, drawn under the answers rather than only hovered, so
 * a reader on a phone reads what Resume will do before pressing it. */
function InboxActionsDo(props: {
  readonly entry: InboxEntryResponse;
  readonly actions: readonly TicketAction[];
  readonly idOf: (index: number) => string;
}): ReactNode {
  const text = useCopyText();
  const kind = inboxEntryPhased(props.entry)?.escalation?.kind;
  return (
    <dl className="inbox-item-does">
      {props.actions.map((action, index) => (
        <div key={nativeActionAnswerKey(action)}>
          <dt>{text(inboxActionLabel(action.action))}</dt>
          <dd id={props.idOf(index)}>
            {text(ticketActionSentence(action.action, { kind }))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The answers an item offers, each evaluation approval asking this reader as
 * a question of its own, Revoke asking in a dialog before it is sent because
 * a revoked ticket is final, and the first other answer the item's primary
 * where its group's own answers are these. */
function InboxActions(props: {
  readonly partition: PartitionIdentity;
  readonly entry: InboxEntryResponse;
  readonly answer: InboxAnswer | undefined;
  readonly onAnswer: (action: TicketAction) => void;
  readonly primary: boolean;
}): ReactNode {
  const text = useCopyText();
  const [revoking, setRevoking] = useState(false);
  const { offered, approvals, actions } = inboxRowAnswers(
    props.entry,
    useProjectAbilities(props.partition),
    text,
  );
  const revoke = actions.find((action) => action.action === "Revoke");
  const primary = props.primary
    ? actions.find((action) => action !== revoke)
    : undefined;
  const busy = inboxAnswerInFlight(props.answer?.step);
  const doesId = useId();
  const doesIdOf = (index: number) => `${doesId}-${String(index)}`;
  if (offered.length === 0)
    return <p className="inbox-item-said">{text({ id: "inbox-no-action" })}</p>;
  return (
    <>
      <TicketApprovals
        partition={props.partition}
        ticket={props.entry.ticket.ticket}
        approvals={approvals}
        busy={busy}
        onAnswer={props.onAnswer}
      />
      {actions.length === 0 ? null : (
        <div className="inbox-item-answers">
          {actions.map((action, index) => (
            <InboxActionButton
              key={nativeActionAnswerKey(action)}
              action={action}
              describedBy={doesIdOf(index)}
              primary={action === primary}
              busy={busy}
              onPress={() => {
                if (action === revoke) setRevoking(true);
                else props.onAnswer(action);
              }}
            />
          ))}
        </div>
      )}
      {actions.length === 0 ? null : (
        <InboxActionsDo entry={props.entry} actions={actions} idOf={doesIdOf} />
      )}
      {revoke === undefined ? null : (
        <InboxRevokeAsk
          open={revoking}
          onOpenChange={setRevoking}
          onRevoke={() => {
            props.onAnswer(revoke);
          }}
        />
      )}
    </>
  );
}

/** Revoke's question, asked over the page because a revoked ticket is final. */
function InboxRevokeAsk(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRevoke: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <ConfirmDialog
      title={text({ id: "ticket-revoke-confirm-title" })}
      confirm={text({ id: "ticket-revoke-confirm" })}
      danger
      open={props.open}
      onOpenChange={props.onOpenChange}
      onConfirm={props.onRevoke}
    >
      {text({ id: "ticket-revoke-warning" })}
    </ConfirmDialog>
  );
}

/** What an item says beside its answers, as one line of the parts it has,
 * and after them the words a worker kept, which are data rather than copy. */
function InboxSaid(props: {
  readonly said: readonly string[];
  readonly kept?: string | undefined;
}): ReactNode {
  if (props.said.length === 0 && props.kept === undefined) return null;
  return (
    <p className="inbox-item-said">
      {props.said.join(" · ")}
      {props.kept === undefined ? null : (
        <>
          {props.said.length === 0 ? null : " · "}
          <span translate="no">{props.kept}</span>
        </>
      )}
    </p>
  );
}

/** A lost job: the runner, how often it was lost and resumed, and the first
 * line its worker kept where it kept one. */
function InboxLostSaid(props: {
  readonly partition: PartitionIdentity;
  readonly lost: RunnerLoss;
}): ReactNode {
  const lost = props.lost;
  const text = useCopyText();
  const reason = useRunReason(props.partition, lost.execution, lost.attempt);
  return (
    <InboxSaid
      said={[text(runnerLossDetail(lost)), text(runnerLossLine(lost))]}
      kept={lost.error === undefined ? undefined : reason?.line}
    />
  );
}

/** A stopped job: the step it stopped at, and the first line its worker kept
 * where it kept one. */
function InboxFailedSaid(props: {
  readonly partition: PartitionIdentity;
  readonly failed: RunStepFailure;
}): ReactNode {
  const failed = props.failed;
  const text = useCopyText();
  const reason = useRunReason(
    props.partition,
    failed.execution,
    failed.attempt,
  );
  return (
    <InboxSaid
      said={[text(runStepLabel(failed.evidence))]}
      kept={failed.error === undefined ? undefined : reason?.line}
    />
  );
}

/** An open evaluation approval: what it awaits, and of whom where it does not
 * ask this reader. */
function InboxAsked(props: {
  readonly partition: PartitionIdentity;
  readonly action: InboxEntryResponse["actions"][number];
}): ReactNode {
  const text = useCopyText();
  const { action } = props;
  const asks = action.approval;
  if (asks === undefined || action.answerable)
    return (
      <p className="inbox-item-said">
        {text(nativeActionKindSentence(action.kind))}
      </p>
    );
  return (
    <p className="inbox-item-said">
      <span>
        {text({ id: "sentences-native-evaluation-approval-awaited" })}
      </span>{" "}
      <ApprovalApproversDrawn
        partition={props.partition}
        approvers={approvalApproversOf(asks.approvers)}
      />
    </p>
  );
}

/** Why this ticket is here: what stopped it where its phase is what holds it,
 * and what its open approvals await where it is not. */
function InboxWhy(props: {
  readonly partition: PartitionIdentity;
  readonly entry: InboxEntryResponse;
  readonly nowMs: number;
}): ReactNode {
  const held = inboxEntryPhased(props.entry);
  const text = useCopyText();
  if (held === undefined)
    return props.entry.actions
      .filter((action) => action.kind === "EvaluationApproval")
      .map((action) => (
        <InboxAsked
          key={action.action}
          partition={props.partition}
          action={action}
        />
      ));
  const lost = held.escalation?.lost;
  if (lost !== undefined)
    return <InboxLostSaid partition={props.partition} lost={lost} />;
  const failed = held.escalation?.failed;
  if (failed !== undefined)
    return <InboxFailedSaid partition={props.partition} failed={failed} />;
  const kind = held.escalation?.kind;
  const resume = held.escalation?.usageResume;
  return (
    <InboxSaid
      said={[
        ...(kind === undefined ? [] : [text(escalationKindSentence(kind))]),
        ...(resume === undefined
          ? []
          : [text(usageResumeLine(resume, props.nowMs))]),
      ]}
    />
  );
}

/** One press of an item's answer: the ticket's attempt it follows, the step it
 * starts from, and where its follow reports. */
interface InboxAnswerPressed {
  readonly held: TicketAttempt;
  readonly startedFrom: OperationStep;
  readonly progress: ConsoleWriteProgress<OperationStep>;
}

/** One ticket's answer, followed to settlement and refused wherever the actor
 * did not take it, its attempt dropped where the API has answered for it as
 * the ticket page drops it. The inbox is not read again for it: a frame or a
 * poll is what moves an item. */
function inboxAnswerWrite(
  partition: PartitionIdentity,
  ticket: number,
  dispatch: ConsoleDispatch,
  text: CopyText,
): ConsoleWrite<InboxAnswerPressed, OperationStep> {
  return {
    mutationKey: consoleWriteKey(
      "inbox-answer",
      partition.tenant,
      partition.project,
      ticket,
    ),
    write: async (ports, pressed) => {
      const { held } = pressed;
      const step = await followOperationProgressed(
        ports,
        partition,
        { operation: held.operation, mutation: held.action.mutation },
        ticket,
        pressed.progress,
        text({ id: "inbox-answer-unsaid" }),
        pressed.startedFrom,
      );
      if (operationAnswered(step))
        dispatch(ticketAttemptDroppedAt({ partition, ticket }));
      const refused = inboxAnswerRefusal(step, text);
      if (refused !== undefined)
        throw new ConsoleWriteRefused(refused, operationAbandonFailure(step));
      return { outcome: "Ok", value: step };
    },
    refusal: (failure) => text(operationFailureSentence(failure)),
  };
}

/** An item's answer and the press that sends one, each item answering under its
 * own ticket's key and through the ticket's one attempt, so a press where one
 * stands follows it rather than drawing a second identity. */
function useInboxAnswer(
  partition: PartitionIdentity,
  ticket: number,
): {
  readonly answer: InboxAnswer | undefined;
  readonly onAnswer: (action: TicketAction) => void;
} {
  const dispatch = useConsoleDispatch();
  const text = useCopyText();
  const writing = useConsoleWrite(
    inboxAnswerWrite(partition, ticket, dispatch, text),
    { drawn: true },
  );
  const reported = useConsoleWriteProgress(writing.variables?.progress);
  const step =
    reported ??
    (writing.isPending ? writing.variables?.startedFrom : undefined);
  const action = writing.variables?.held.action;
  const answer = useMemo(
    () =>
      action === undefined || step === undefined ? undefined : { action, step },
    [action, step],
  );
  return {
    answer,
    onAnswer: (pressed) => {
      writing.mutate({
        ...dispatch(ticketAttemptPressed(partition, ticket, pressed)),
        progress: new ConsoleWriteProgress<OperationStep>(),
      });
    },
  };
}

/** What an item asks, and who asks it. */
function inboxItemAsk(kind: InboxGroupKind): {
  readonly ask: Copy;
  readonly asker: Copy;
} {
  switch (kind) {
    case "Approvals":
      return {
        ask: { id: "inbox-ask-approval" },
        asker: { id: "inbox-asker-evaluation" },
      };
    case "Questions":
      return {
        ask: { id: "inbox-ask-escalation" },
        asker: { id: "inbox-asker-escalation" },
      };
  }
}

/** The mark of what an item is: an approval, or the standing of the ticket a
 * question is about. */
function InboxItemBadge(props: {
  readonly kind: InboxGroupKind;
  readonly entry: InboxEntryResponse;
  readonly row: ProjectTableRow;
}): ReactNode {
  const text = useCopyText();
  const { entry, row } = props;
  const open = entry.actions[0];
  switch (props.kind) {
    case "Approvals":
      return (
        <StatusBadge tone="evaluation" size="small">
          {text({ id: "inbox-kind-approval" })}
        </StatusBadge>
      );
    case "Questions":
      return (
        <StatusBadge tone="parked" size="small">
          {inboxEntryPhased(entry) === undefined && open !== undefined
            ? text(nativeActionKindSentence(open.kind))
            : text(row.badge ?? phaseLabel(row.phase))}
        </StatusBadge>
      );
  }
}

/** The ticket an item is about, how long ago it last moved, and how its last
 * run ended where one ran. */
function InboxItemMeta(props: {
  readonly item: InboxItem;
  readonly asker: string;
  readonly row: ProjectTableRow;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const row = props.row;
  const ticket = `#${String(row.ticket)}`;
  return (
    <>
      <span
        className="inbox-item-fixed"
        data-inbox-item={inboxItemName(props.item)}
      >
        {props.asker}
      </span>
      <span className="inbox-item-ticket">
        {row.title === undefined ? ticket : `${ticket} ${row.title}`}
      </span>
      <span className="inbox-item-fixed">
        <TicketActivity activityAt={row.activityAt} nowMs={props.nowMs} />
      </span>
      {row.executionVerdict === undefined ? null : (
        <span className="inbox-item-run">
          {text({ id: "inbox-last-run" })} <TicketRowExecutionCell row={row} />
        </span>
      )}
    </>
  );
}

/** What this tab's answer came to, said in the item it was given in. */
function InboxAnswerSaid(props: {
  readonly answer: InboxAnswer | undefined;
}): ReactNode {
  const text = useCopyText();
  const answer = props.answer;
  if (answer === undefined) return null;
  const detail = inboxStepDetail(answer.step);
  return (
    <InboxSaid
      said={[
        inboxStepSentence(answer.step, text),
        ...(detail === undefined ? [] : [copyOrDataText(text, detail)]),
      ]}
    />
  );
}

/** One item: what it asks as its title, linking to its ticket; who asks, the
 * ticket and when in its meta line; its mark; and in its foot why it is here
 * beside the answers to it. */
function InboxItemRow(props: {
  readonly kind: InboxGroupKind;
  readonly entry: InboxEntryResponse;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const { kind, entry } = props;
  const row = projectTableRow(entry.ticket);
  const text = useCopyText();
  const { answer, onAnswer } = useInboxAnswer(props.partition, row.ticket);
  const { ask, asker } = inboxItemAsk(kind);
  return (
    <RecordRow
      title={text(ask)}
      link={{
        to: "/$tenant/$project/tickets/$ticket",
        params: { ...props.partition, ticket: String(row.ticket) },
      }}
      level={3}
      meta={
        <InboxItemMeta
          item={{ kind, ticket: row.ticket }}
          asker={text(asker)}
          row={row}
          nowMs={props.nowMs}
        />
      }
      trailing={<InboxItemBadge kind={kind} entry={entry} row={row} />}
      foot={
        <div className="inbox-item-foot">
          <InboxWhy
            partition={props.partition}
            entry={entry}
            nowMs={props.nowMs}
          />
          <InboxActions
            partition={props.partition}
            entry={entry}
            answer={answer}
            onAnswer={onAnswer}
            primary={kind === "Questions"}
          />
          <InboxAnswerSaid answer={answer} />
        </div>
      }
    />
  );
}

const inboxGroupTitles = {
  Approvals: { id: "inbox-group-approvals" },
  Questions: { id: "inbox-group-questions" },
} as const satisfies Record<InboxGroupKind, Copy>;

/** What names an item in the document, which is where focus is found again. */
function inboxItemName(item: InboxItem): string {
  return `${item.kind}-${String(item.ticket)}`;
}

/** One group under its heading and its count, its items one list. */
function InboxGroupDrawn(props: {
  readonly group: InboxGroup;
  readonly headingId: string;
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const { group } = props;
  const title = text(inboxGroupTitles[group.kind]);
  const count = group.entries.length;
  return (
    <section className="inbox-group" aria-labelledby={props.headingId}>
      <h2 className="inbox-group-title" id={props.headingId} tabIndex={-1}>
        {title}
        <CountBadge
          count={count}
          name={text({
            id: "inbox-group-count",
            args: { count: String(count) },
          })}
        />
      </h2>
      <RecordList label={title}>
        {group.entries.map((entry) => (
          <InboxItemRow
            key={entry.ticket.ticket}
            kind={group.kind}
            entry={entry}
            partition={props.partition}
            nowMs={props.nowMs}
          />
        ))}
      </RecordList>
    </section>
  );
}

/** The element `target` names under `root`: an item's title link, a group's
 * heading, or the line saying the inbox is clear. */
function inboxFocusElement(
  root: HTMLElement,
  target: InboxFocusTarget,
  headingIdOf: (kind: InboxGroupKind) => string,
): HTMLElement | null {
  switch (target.to) {
    case "Item":
      return (
        root
          .querySelector(`[data-inbox-item="${inboxItemName(target.item)}"]`)
          ?.closest("li")
          ?.querySelector("a") ?? null
      );
    case "Group":
      return root.querySelector(`[id="${headingIdOf(target.kind)}"]`);
    case "Clear":
      return root.querySelector("[data-inbox-clear]");
  }
}

/** The item focus was last in, from a focus event anywhere under the groups. */
function inboxItemFocused(
  target: EventTarget,
  groups: readonly InboxGroup[],
): InboxItem | undefined {
  if (!(target instanceof Element)) return undefined;
  const name = target
    .closest("li")
    ?.querySelector("[data-inbox-item]")
    ?.getAttribute("data-inbox-item");
  for (const group of groups)
    for (const entry of group.entries) {
      const item = { kind: group.kind, ticket: entry.ticket.ticket };
      if (inboxItemName(item) === name) return item;
    }
  return undefined;
}

/**
 * Focus kept across an item leaving: where the item focus was last in is no
 * longer drawn and focus went with it, it moves to where `inboxFocusAfter`
 * says. Focus the reader took elsewhere is left where it is.
 */
function useInboxFocusKept(
  groups: readonly InboxGroup[],
  headingIdOf: (kind: InboxGroupKind) => string,
): {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly onFocus: (event: FocusEvent) => void;
} {
  const root = useRef<HTMLDivElement>(null);
  const held = useRef<InboxItem | undefined>(undefined);
  const drawn = useRef(groups);
  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = groups;
    const item = held.current;
    if (item === undefined || inboxGroupsHold(groups, item)) return;
    held.current = undefined;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected)
      return;
    const element =
      root.current === null
        ? null
        : inboxFocusElement(
            root.current,
            inboxFocusAfter(before, groups, item),
            headingIdOf,
          );
    element?.focus();
  }, [groups, headingIdOf]);
  return {
    root,
    onFocus: (event) => {
      const item = inboxItemFocused(event.target, drawn.current);
      if (item !== undefined) held.current = item;
    },
  };
}

/** Every group the inbox's entries make, or the one line saying it is clear. */
function InboxGroups(props: {
  readonly entries: readonly InboxEntryResponse[];
  readonly partition: PartitionIdentity;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const groups = useMemo(() => inboxGroups(props.entries), [props.entries]);
  const headings = useId();
  const headingIdOf = useCallback(
    (kind: InboxGroupKind) => `${headings}-${kind}`,
    [headings],
  );
  const { root, onFocus } = useInboxFocusKept(groups, headingIdOf);
  return (
    <div className="inbox-groups" ref={root} onFocus={onFocus}>
      {groups.length === 0 ? (
        <div data-inbox-clear="" tabIndex={-1}>
          <EmptyState label={text({ id: "inbox-clear" })} />
        </div>
      ) : (
        groups.map((group) => (
          <InboxGroupDrawn
            key={group.kind}
            group={group}
            headingId={headingIdOf(group.kind)}
            partition={props.partition}
            nowMs={props.nowMs}
          />
        ))
      )}
    </div>
  );
}

/** A further page the reader asked for that could not be read, beside the items that were. */
function InboxPageFailure(props: {
  readonly rows: InboxRows | undefined;
}): ReactNode {
  const text = useCopyText();
  const failure = props.rows?.failure;
  return failure === undefined ? null : (
    <ReadFailed subject={text({ id: "inbox-more-failed" })} failure={failure} />
  );
}

/** The screen itself, taking the partition rather than reading the route, so a
 * suite can mount it. */
export function InboxScreen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const partition = props.partition;
  const inbox = useInboxRows(partition);
  const nowMs = useNowMs();
  return (
    <div className="inbox-page" data-fills-width>
      <ScreenTitle>{text({ id: "inbox-title" })}</ScreenTitle>
      <RepositoryImportRefusedNotice partition={partition} />
      <InboxPageFailure rows={inbox.rows} />
      <DataSection state={inbox.panel}>
        {(rows) => (
          <InboxGroups
            entries={rows.entries}
            partition={partition}
            nowMs={nowMs}
          />
        )}
      </DataSection>
      {inbox.readMore === undefined ? null : (
        <div>
          <Button size="sm" onClick={inbox.readMore}>
            {text({ id: "inbox-more" })}
          </Button>
        </div>
      )}
      {inbox.reading ? (
        <p className="panel-note">{text({ id: "inbox-loading" })}</p>
      ) : null}
    </div>
  );
}

export function Inbox(): ReactNode {
  return <InboxScreen partition={useParams({ from: "/$tenant/$project" })} />;
}
