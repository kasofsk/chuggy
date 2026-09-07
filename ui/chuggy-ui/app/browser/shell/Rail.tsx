/**
 * The console's navigation: the brand and project switcher at the head, the
 * project's own entries fixed above the list, the reader's own conversations
 * scrolling beneath them, and the account controls at the foot.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ThreadEntryResponse,
  ThreadsResponse,
} from "../../../../../src/contract/responses.ts";
import {
  apiCloseThread,
  apiOpenThread,
  apiProjectInventoryAll,
  apiThread,
  apiThreads,
} from "../../core/apiRoutes.ts";
import { panelReason } from "../../core/freshness.ts";
import { inboxCountLabel } from "../../core/inboxList.ts";
import { lastProjectWrite } from "../../core/lastProject.ts";
import { leadSessionNamed } from "../../core/leadTranscript.ts";
import {
  projectListReread,
  projectListRereadNamed,
} from "../../core/projectQueryKeys.ts";
import { railRoutes, shellRail } from "../../core/shellRail.ts";
import type {
  RailConversations,
  RailEntry,
  RailStanding,
  ShellRail,
} from "../../core/shellRail.ts";
import { threadAnswering, threadMine } from "../../core/threads.ts";
import { sessionStateTone } from "../../core/tones.ts";
import type { Tone } from "../../core/tones.ts";
import { useApiPorts, usePanelInventory, usePanelList } from "../api.ts";
import { Footer } from "../Footer.tsx";
import { useNowMs } from "../Freshness.tsx";
import { useInboxRows } from "../Inbox.tsx";
import { useLead } from "../LeadPage.tsx";
import { persistentStore } from "../ports.ts";
import { useSessionHolder } from "../session.tsx";
import {
  themeChoiceApply,
  themeChoiceRead,
  themeChoiceWrite,
  themeChoices,
} from "../theme.ts";
import type { ThemeChoice } from "../theme.ts";
import { ThreadEntryLabel } from "../thread/ThreadEntryLabel.tsx";
import { threadsListName } from "../ThreadsPage.tsx";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";

/** The fill a standing's dot takes, total over the roster so a tone the wire
 * grows stops compiling rather than drawing nothing. */
const railDotFills: Readonly<Record<Tone, string>> = {
  pass: "bg-tone-pass",
  fail: "bg-tone-fail",
  live: "bg-tone-live",
  queued: "bg-tone-queued",
  parked: "bg-tone-parked",
  retired: "bg-tone-retired",
  neutral: "bg-ink-3",
};

function RailDot(props: { readonly standing: RailStanding }): ReactNode {
  return (
    <>
      <i
        aria-hidden="true"
        className={`block size-2 shrink-0 rounded-circle ${railDotFills[props.standing.tone]}`}
      />
      <span className="visually-hidden">{props.standing.word}</span>
    </>
  );
}

function RailEntryContent(props: { readonly entry: RailEntry }): ReactNode {
  const entry = props.entry;
  return (
    <>
      {entry.standing === undefined ? null : (
        <RailDot standing={entry.standing} />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.count === undefined ? null : (
        <span className="text-xs text-ink-3 tabular-nums">{entry.count}</span>
      )}
    </>
  );
}

const railEntryClassName =
  "flex items-center gap-2 rounded-2 px-3 py-2 text-md no-underline";

/** A route the entry names: every fixed entry, the lead and `All threads`. */
function RailNavEntry(props: {
  readonly entry: RailEntry;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const entry = props.entry;
  if (entry.to === undefined || entry.params === undefined) return null;
  return (
    <li>
      <Link
        to={entry.to}
        params={entry.params}
        onClick={props.onNavigate}
        className={railEntryClassName}
        activeProps={{ className: "bg-surface-2 text-ink-1" }}
        inactiveProps={{
          className: entry.closed === true ? "text-ink-3" : "text-ink-2",
        }}
      >
        <RailEntryContent entry={entry} />
      </Link>
    </li>
  );
}

/** One of the reader's own threads: the shared label-and-menu, in a row that
 * reveals the menu's trigger on hover or focus. */
function RailThreadEntry(props: {
  readonly thread: ThreadEntryResponse;
  readonly closed: boolean;
  readonly partition: PartitionIdentity;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  return (
    <li
      className={`group flex items-center gap-2 rounded-2 px-3 py-2 text-md ${
        props.closed ? "text-ink-3" : "text-ink-2"
      }`}
    >
      <ThreadEntryLabel
        partition={props.partition}
        thread={props.thread}
        onNavigate={props.onNavigate}
      />
    </li>
  );
}

/** The offer `New thread` makes: opened where the reader has none, closed and
 * reopened where they do, or refused while the one they have is still
 * answering. */
function RailNewThreadEntry(props: {
  readonly entry: RailEntry;
  readonly partition: PartitionIdentity;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const entry = props.entry;
  const ports = useApiPorts();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  return (
    <li>
      <button
        type="button"
        aria-busy={busy}
        disabled={entry.disabled === true || busy}
        className={`${railEntryClassName} bg-surface-1 text-ink-2 disabled:text-ink-3 cursor-pointer border-0 text-left disabled:cursor-not-allowed`}
        onClick={() => {
          setBusy(true);
          setRefused(undefined);
          const closes = entry.closes;
          const opened =
            closes === undefined
              ? apiOpenThread(ports, props.partition)
              : apiCloseThread(ports, props.partition, closes).then((closed) =>
                  closed.outcome === "Ok"
                    ? apiOpenThread(ports, props.partition)
                    : closed,
                );
          void opened.then((result) => {
            setBusy(false);
            if (result.outcome !== "Ok") {
              setRefused(panelReason(result));
              return;
            }
            props.onNavigate?.();
            void navigate({
              to: railRoutes.thread,
              params: { ...props.partition, session: result.value.session },
            });
          });
        }}
      >
        <RailEntryContent entry={entry} />
      </button>
      {refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${refused}`} />
      )}
    </li>
  );
}

/** The section's own foot, a link rather than a list item: it names no
 * thread, so it draws beneath the list rather than inside it as one more
 * entry of a kind it is not. */
function RailAllThreadsEntry(props: {
  readonly entry: RailEntry;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const entry = props.entry;
  if (entry.to === undefined || entry.params === undefined) return null;
  return (
    <Link
      to={entry.to}
      params={entry.params}
      onClick={props.onNavigate}
      className={`${railEntryClassName} text-ink-2`}
    >
      {entry.label}
    </Link>
  );
}

function RailConversationsSection(props: {
  readonly conversations: RailConversations;
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly partition: PartitionIdentity;
  readonly allThreads: RailEntry;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const conversations = props.conversations;
  return (
    <div className="grid gap-4">
      <section className="grid gap-1">
        <h2 className="px-3 text-xs font-medium tracking-label text-ink-3 uppercase">
          Conversations
        </h2>
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          <RailNavEntry
            entry={conversations.lead}
            onNavigate={props.onNavigate}
          />
          {conversations.newThread === undefined ? null : (
            <RailNewThreadEntry
              entry={conversations.newThread}
              partition={props.partition}
              onNavigate={props.onNavigate}
            />
          )}
        </ul>
        {conversations.groups.map((group) => (
          <div key={group.heading}>
            <div className="text-ink-3 px-3 pt-2 pb-1 text-xs">
              {group.heading}
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)]">
              {group.entries.map((entry) => {
                const thread = props.threads?.find(
                  (candidate) => candidate.session === entry.id,
                );
                return thread === undefined ? null : (
                  <RailThreadEntry
                    key={entry.id}
                    thread={thread}
                    closed={entry.closed === true}
                    partition={props.partition}
                    onNavigate={props.onNavigate}
                  />
                );
              })}
            </ul>
          </div>
        ))}
        <RailAllThreadsEntry
          entry={props.allThreads}
          onNavigate={props.onNavigate}
        />
      </section>
    </div>
  );
}

function RailProjectSwitcher(props: {
  readonly partition: PartitionIdentity;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  if (state.state !== "Ready")
    return <Notice tone="parked" inline detail="Projects unavailable" />;
  return (
    <Picker
      label="Project"
      value={`${props.partition.tenant}/${props.partition.project}`}
      options={state.value.map((candidate) => ({
        value: `${candidate.tenant}/${candidate.project}`,
        text: `${candidate.tenant} / ${candidate.project}`,
      }))}
      onChoose={(picked) => {
        const chosen = state.value.find(
          (candidate) => `${candidate.tenant}/${candidate.project}` === picked,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        props.onNavigate?.();
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
    />
  );
}

/** The choice is applied before it is stored, so a store a browser refuses
 * still leaves the operator looking at the theme they asked for. */
export function ThemeControl(): ReactNode {
  const [chosen, setChosen] = useState<ThemeChoice>(() =>
    themeChoiceRead(persistentStore),
  );
  return (
    <ToggleGroup
      label="Theme"
      options={themeChoices}
      value={chosen}
      onChange={(value) => {
        const choice = themeChoices.find((candidate) => candidate === value);
        if (choice === undefined) return;
        themeChoiceApply(document.documentElement, choice);
        themeChoiceWrite(persistentStore, choice);
        setChosen(choice);
      }}
    />
  );
}

function RailHead(props: {
  readonly partition: PartitionIdentity;
  readonly onNavigate: (() => void) | undefined;
}): ReactNode {
  return (
    <div className="grid gap-3 px-4">
      <Link
        to="/"
        onClick={props.onNavigate}
        className="text-md font-strong tracking-label text-ink-1 no-underline"
      >
        chuggy
      </Link>
      <RailProjectSwitcher
        partition={props.partition}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

function RailFoot(): ReactNode {
  const holder = useSessionHolder();
  return (
    <div className="border-edge grid justify-items-start gap-3 border-t px-4 pt-3">
      <ThemeControl />
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          void holder.signOut();
        }}
      >
        Sign out
      </Button>
      <Footer />
    </div>
  );
}

/** Whether the reader's own open thread, if any, has a turn the mailbox has
 * not settled. */
/** The list entry the reader's own open thread keeps its answering read
 * under, distinct from the thread page's own so the two entries never share
 * a cache slot over different result shapes. */
function railAnsweringListName(session: string): string {
  return `rail-answering-${session}`;
}

/** Whether the reader's own open thread, if any, has a turn the mailbox has
 * not settled — re-read on the `Session` frame that names it, as
 * `ThreadPage`'s own read is. */
function useThreadAnswering(
  partition: PartitionIdentity,
  session: string | undefined,
): boolean {
  const state = usePanelList(
    projectListRereadNamed<boolean>(
      partition,
      "Session",
      session === undefined ? "rail-answering" : railAnsweringListName(session),
      (change) =>
        session !== undefined && leadSessionNamed(change.resource) === session,
    ),
    async (ports) => {
      if (session === undefined) return { outcome: "Ok", value: false };
      const result = await apiThread(ports, partition, session);
      return result.outcome === "Ok"
        ? { outcome: "Ok", value: threadAnswering(result.value) }
        : result;
    },
  );
  return state.state === "Ready" && state.value;
}

function useRail(partition: PartitionIdentity): {
  readonly rail: ShellRail;
  readonly threads: readonly ThreadEntryResponse[] | undefined;
} {
  const threadsState = usePanelList(
    projectListReread<ThreadsResponse>(partition, "Session", threadsListName),
    (ports) => apiThreads(ports, partition),
  );
  const lead = useLead(partition);
  const inbox = useInboxRows(partition);
  const threads =
    threadsState.state === "Ready" ? threadsState.value.threads : undefined;
  const answering = useThreadAnswering(
    partition,
    threads === undefined ? undefined : threadMine(threads)?.session,
  );
  const nowMs = useNowMs();
  const rail = shellRail({
    partition,
    threads,
    leadStanding:
      lead.state === "Ready"
        ? { word: lead.value.state, tone: sessionStateTone(lead.value.state) }
        : undefined,
    inboxCount: inboxCountLabel(inbox.union),
    answering,
    nowMs,
  });
  return { rail, threads };
}

export function Rail(props: {
  readonly partition: PartitionIdentity;
  readonly onNavigate?: (() => void) | undefined;
}): ReactNode {
  const { rail, threads } = useRail(props.partition);
  return (
    <nav
      aria-label="Console"
      className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 bg-surface-1 py-4"
    >
      <RailHead partition={props.partition} onNavigate={props.onNavigate} />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2">
        {rail.fixed.map((entry) => (
          <RailNavEntry
            key={entry.id}
            entry={entry}
            onNavigate={props.onNavigate}
          />
        ))}
      </ul>
      <div className="min-h-0 overflow-y-auto px-2">
        <RailConversationsSection
          conversations={rail.conversations}
          threads={threads}
          partition={props.partition}
          allThreads={rail.allThreads}
          onNavigate={props.onNavigate}
        />
      </div>
      <RailFoot />
    </nav>
  );
}
