/**
 * What each press of Send and Stop on a thread writes, one record per
 * composer, so what a press ends as outlives the box it was pressed in. A
 * thread's record is named by its home and session, and a first box's, which
 * has no session, by its home alone. What each move does is
 * `core/threads.ts`'s.
 *
 * THE TURN IDENTITY BELONGS TO THE TEXT AND ITS IMAGES. A press the door did
 * not take keeps its turn, so the same text and images pressed again reach the
 * same row; an edit, or another set of images, is a turn of its own.
 *
 * EACH IMAGE IS UPLOADED BEFORE THE MESSAGE IS SENT, and an upload that fails
 * sends nothing. An image the project took is not given it again by a retry;
 * a message the door refused forgets them, since what it refused may have been
 * one of them.
 *
 * A SENT MESSAGE ARRIVES THE WAY EVERY OTHER TURN DOES: a project's frame
 * stales the thread read, so nothing here reads it again, and the record draws
 * the message until that read lists its turn. No frame names a member's own
 * chat, so it is read again here.
 *
 * A FIRST BOX OPENS ITS THREAD UNDER ONE KEY, held from its first open until
 * its message is taken, so a press after a failed open reaches the thread that
 * one may have opened, and one after a failed send the thread it opened.
 *
 * THE GRANT IS ASKED ONLY WHERE THE THREAD RUNS IN CLUSTER. A member's own
 * chat asks none, and carries no images, which only a project keeps.
 *
 * A REFUSAL NO BOX THAT PRESSED IS DRAWN FOR IS KEPT, and the next box of the
 * thread takes it as its own last press. A refusal is said until the reader
 * edits or presses again, and a stop's until its turn is read ended.
 *
 * THE PRESS IS THE STOP, AND THE MAILBOX HAS THE LAST WORD. A turn reads
 * stopped from the press, and a press that stopped nothing is taken back and
 * counted. A stop pressed before its message was taken waits on the send and
 * goes to the thread it reached; a send handed back leaves nothing to stop.
 *
 * IMAGES AND SENDS ON THEIR WAY ARE `extra`'s, by turn, since bytes and
 * promises never enter the store. An image goes once no record names its turn.
 */

import { createSlice } from "@reduxjs/toolkit";
import type {
  PayloadAction,
  ThunkAction,
  UnknownAction,
} from "@reduxjs/toolkit";
import type { QueryClient } from "@tanstack/react-query";

import {
  partitionPath,
  threadBacklogMax,
} from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import { apiUploadProjectArtifact } from "../../core/apiRoutes.ts";
import type { ConversationAttachment } from "../../core/conversationAttachments.ts";
import {
  hostedRunsQuery,
  sessionPlacementQuery,
} from "../../core/projectQueries.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { apiOpenThreadAt, apiStopThreadTurnAt } from "../../core/threadHome.ts";
import type { ThreadHome } from "../../core/threadHome.ts";
import { threadMessageSent } from "../../core/threadSendRun.ts";
import {
  threadKeptClosed,
  threadLimitWord,
  threadOpenAtLimit,
  threadOpenKeyBytesCount,
  threadOpenKeyMinted,
  threadRefusalCause,
  threadSendBegan,
  threadSendClosed,
  threadSendEnded,
  threadSendFirstLeft,
  threadSendIdled,
  threadSendListed,
  threadSendOpened,
  threadSendRecordName,
  threadSendRecordOf,
  threadSendRecordWith,
  threadSendRefused,
  threadSendTaken,
  threadSendTurnsNamed,
  threadStopFrom,
  threadStopPressedOn,
  threadStopTakenBack,
  threadTakesMessages,
  threadTurnIdBytesCount,
  threadTurnMinted,
  threadTurnRetained,
  threadUnhosted,
  threadUploadRefused,
} from "../../core/threads.ts";
import type {
  ThreadSend,
  ThreadSending,
  ThreadSendRecord,
  ThreadSendRecords,
  ThreadStop,
} from "../../core/threads.ts";
import { drawBytes } from "../ports.ts";
import {
  chatPaneOpeningAt,
  chatPaneRecordAt,
  chatPaneStartingAt,
} from "../shell/chatPanes.ts";
import type { ChatPanesHeld } from "../shell/chatPanes.ts";
import type {
  ConsoleExtra,
  ThreadSendFlight,
  ThreadSendsCarried,
} from "../storeExtra.ts";
import { memberChatReread } from "./threadRead.ts";

/** Which record an action writes. */
interface ThreadSendAt {
  readonly name: string;
}

const threadSendRecordsEmpty: ThreadSendRecords = {};

/** The reducer that writes one record as `move` says. */
function threadSendMove<P extends ThreadSendAt>(
  move: (record: ThreadSendRecord, payload: P) => ThreadSendRecord,
) {
  return (records: ThreadSendRecords, action: PayloadAction<P>) =>
    threadSendRecordWith(records, action.payload.name, (record) =>
      move(record, action.payload),
    );
}

export const threadSends = createSlice({
  name: "threadSends",
  initialState: threadSendRecordsEmpty,
  reducers: {
    threadSendBeganAt: threadSendMove(
      (record, payload: ThreadSendAt & { readonly sent: ThreadSending }) =>
        threadSendBegan(record, payload.sent),
    ),
    threadSendOpenKeyHeldAt: threadSendMove(
      (record, payload: ThreadSendAt & { readonly key: string }) => ({
        ...record,
        openKey: payload.key,
      }),
    ),
    threadSendOpenedAt: threadSendMove(
      (record, payload: ThreadSendAt & { readonly session: string }) =>
        threadSendOpened(record, payload.session),
    ),
    threadSendEndedAt: threadSendMove(
      (record, payload: ThreadSendAt & Parameters<typeof threadSendEnded>[1]) =>
        threadSendEnded(record, payload),
    ),
    threadSendIdledAt: threadSendMove(threadSendIdled),
    threadSendListedAt: threadSendMove(
      (
        record,
        payload: ThreadSendAt & { readonly listed: readonly string[] },
      ) => threadSendListed(record, payload.listed),
    ),
    threadSendTakenAt: threadSendMove(threadSendTaken),
    threadSendClosedAt: threadSendMove(threadSendClosed),
    threadSendFirstLeftAt: threadSendMove(threadSendFirstLeft),
    threadStoppingAt: threadSendMove(
      (record, payload: ThreadSendAt & { readonly turn: string }) =>
        threadStopPressedOn(record, payload.turn),
    ),
    threadStopBackAt: threadSendMove(
      (
        record,
        payload: ThreadSendAt & {
          readonly turn: string;
          readonly stop: ThreadStop | undefined;
        },
      ) => threadStopTakenBack(record, payload.turn, payload.stop),
    ),
  },
  selectors: {
    threadSendAt: (records, name: string) => threadSendRecordOf(records, name),
  },
});

export const { threadSendIdledAt, threadSendListedAt } = threadSends.actions;

const {
  threadSendBeganAt,
  threadSendOpenKeyHeldAt,
  threadSendOpenedAt,
  threadSendEndedAt,
  threadSendTakenAt,
  threadSendClosedAt,
  threadSendFirstLeftAt,
  threadStoppingAt,
  threadStopBackAt,
} = threadSends.actions;

export const { threadSendAt } = threadSends.selectors;

type ThreadSendsThunk<T> = ThunkAction<
  T,
  {
    readonly threadSends: ThreadSendRecords;
    readonly chatPanes: ChatPanesHeld;
  },
  ConsoleExtra,
  UnknownAction
>;

/** Whether the project's tenant grants the reader hosted runs, as a door
 * answered it: written over the grant's read as the newer word on the
 * question, since no frame names the grant. */
export function threadDoorGranted(
  client: QueryClient,
  partition: PartitionIdentity,
  granted: boolean,
): void {
  client.setQueryData(hostedRunsQuery(partition).queryKey, { granted });
}

/** An open that answered with its thread: the grant had to allow it only
 * where the route was read as hosted. */
export function threadDoorOpened(
  client: QueryClient,
  partition: PartitionIdentity,
): void {
  const placement = sessionPlacementQuery(partition).queryKey;
  if (client.getQueryData(placement)?.thread.route === "InCluster")
    threadDoorGranted(client, partition, true);
}

/**
 * A refusal over the hosted grant, told to the door's reads first: the grant
 * written as not given, and the placement read again now rather than at the
 * next poll, the refusal counting the reads before it. A member's own chat
 * asks no grant, so is never refused one.
 */
async function threadDoorUnhosted(
  client: QueryClient,
  home: ThreadHome,
): Promise<ThreadSend & { readonly send: "Unhosted" }> {
  if (home.scope === "Member")
    throw new Error("a member's own chat was refused a grant it never asks");
  threadDoorGranted(client, home.partition, false);
  const placement = sessionPlacementQuery(home.partition).queryKey;
  const readsAt = client.getQueryState(placement)?.dataUpdateCount ?? 0;
  await client.invalidateQueries({ queryKey: placement });
  return { send: "Unhosted", readsAt };
}

/** What a press carrying images is refused as where no project would keep
 * them, which a composer offering none never meets. */
const threadImagesUnhomed = "Images are kept by a project";

/** The identity each image of a press is named by, uploading those the
 * project has not taken, in order, and the refusal of the first that fails. */
async function threadSendUploaded(
  ports: ApiPorts,
  home: ThreadHome,
  attached: readonly ConversationAttachment[],
  uploaded: ThreadSendsCarried["uploaded"],
): Promise<readonly string[] | ThreadSend> {
  if (attached.length === 0) return [];
  if (home.scope === "Member") return threadSendRefused(threadImagesUnhomed);
  const { partition } = home;
  const project = partitionPath(partition);
  const images: string[] = [];
  for (const attachment of attached) {
    const known = uploaded.get(attachment);
    if (known?.project === project) {
      images.push(known.artifact);
      continue;
    }
    const answered = await apiUploadProjectArtifact(ports, partition, {
      mediaType: attachment.mediaType,
      content: attachment.content,
    });
    if (answered.outcome !== "Ok") return threadUploadRefused(answered);
    uploaded.set(attachment, { project, artifact: answered.value.artifact });
    images.push(answered.value.artifact);
  }
  return images;
}

/** The thread a first press opens, or what the door refused opening one as. */
async function threadSendOpenedAs(
  extra: ConsoleExtra,
  home: ThreadHome,
  key: string,
): Promise<{ readonly session: string } | ThreadSend> {
  const open = await apiOpenThreadAt(extra.ports, home, key);
  if (threadUnhosted(open)) return threadDoorUnhosted(extra.client, home);
  if (sessionRefusedNoRunner(open)) return { send: "NoRunner" };
  if (threadOpenAtLimit(open)) return threadSendRefused(threadLimitWord);
  if (open.outcome !== "Ok") return threadSendRefused(threadRefusalCause(open));
  return { session: open.value.session };
}

/** One message sent to a thread, as the door answered it. */
async function threadSendAnswered(
  extra: ConsoleExtra,
  home: ThreadHome,
  sent: {
    readonly session: string;
    readonly images: readonly string[];
  } & ThreadSending,
): Promise<ThreadSend> {
  const answered = await threadMessageSent(extra.ports, home, sent.session, {
    turn: sent.turn,
    message: sent.text,
    ...(sent.images.length === 0 ? {} : { images: [...sent.images] }),
  });
  if (answered.send !== "Unhosted") return answered;
  return threadDoorUnhosted(extra.client, home);
}

/** One send held under its turn until the door answers it, where fewer are
 * held than the mailbox takes turns. */
async function threadStopFlown(
  flights: Map<string, ThreadSendFlight>,
  turn: string,
  flight: ThreadSendFlight,
): ThreadSendFlight {
  if (flights.size >= threadBacklogMax) return flight;
  flights.set(turn, flight);
  try {
    return await flight;
  } finally {
    flights.delete(turn);
  }
}

/** Each image no record names a turn of any longer let go. */
function threadSendImagesPruned(
  records: ThreadSendRecords,
  carried: ThreadSendsCarried,
): void {
  const named = threadSendTurnsNamed(records);
  for (const turn of carried.images.keys())
    if (!named.has(turn)) carried.images.delete(turn);
}

/** One press, as the box that pressed hands it over. */
export interface ThreadSendPress {
  readonly home: ThreadHome;
  /** Absent for a first box, whose first press opens the thread. */
  readonly session: string | undefined;
  readonly text: string;
  readonly attached: readonly ConversationAttachment[];
  /** Whether the box that pressed is still drawn, absent where none did. */
  readonly drawn?: () => boolean;
}

/** What a press came to for the box that pressed it. */
export interface ThreadSendPressEnded {
  /** Whether that box takes the message back, which it does only where it is
   * still drawn: otherwise the record keeps it. */
  readonly back: boolean;
  /** The thread a first press opened, once its message was taken. */
  readonly started: string | undefined;
}

/** The thread a press sends to: the box's own, the one its first open
 * answered, or one opened now under the key its record holds. */
function threadSendSession(
  press: ThreadSendPress,
  name: string,
): ThreadSendsThunk<Promise<string | ThreadSend>> {
  return async (dispatch, getState, extra) => {
    const record = threadSendAt(getState(), name);
    const standing = press.session ?? record.opened;
    if (standing !== undefined) return standing;
    const key =
      record.openKey ?? threadOpenKeyMinted(drawBytes(threadOpenKeyBytesCount));
    dispatch(threadSendOpenKeyHeldAt({ name, key }));
    const open = await threadSendOpenedAs(extra, press.home, key);
    if ("send" in open) return open;
    dispatch(threadSendOpenedAt({ name, session: open.session }));
    return open.session;
  };
}

/** What a message taken changes beyond its record: a member's own chat read
 * again, and a project's first message handed over to the pane, with the
 * grant its open proved. */
function threadSendLanded(
  press: ThreadSendPress,
  session: string,
): ThreadSendsThunk<void> {
  return (dispatch, _getState, extra) => {
    const { home } = press;
    if (home.scope === "Member") {
      void memberChatReread(extra.client, home.tenant, session);
      return;
    }
    if (press.session !== undefined) return;
    dispatch(chatPaneOpeningAt({ partition: home.partition, session }));
    threadDoorOpened(extra.client, home.partition);
  };
}

/**
 * One press, from its images to the door's answer: the images are uploaded
 * first, so an upload that fails opens no thread and sends nothing, and every
 * ending is said through `said`, which keeps the message where the box that
 * pressed is no longer drawn.
 */
function threadSendRun(
  press: ThreadSendPress,
  name: string,
  sent: ThreadSending,
  said: (send: ThreadSend) => void,
): ThreadSendsThunk<ThreadSendFlight> {
  return async (dispatch, _getState, extra) => {
    const { home, attached } = press;
    const carried = extra.threadSends;
    const images = await threadSendUploaded(
      extra.ports,
      home,
      attached,
      carried.uploaded,
    );
    if ("send" in images) {
      said(images);
      return undefined;
    }
    const session = await dispatch(threadSendSession(press, name));
    if (typeof session !== "string") {
      said(session);
      return undefined;
    }
    const to = { session, images, ...sent };
    const answered = await threadSendAnswered(extra, home, to);
    if (answered.send === "Refused")
      for (const attachment of attached) carried.uploaded.delete(attachment);
    said(answered);
    if (answered.send !== "Sent") return undefined;
    dispatch(threadSendLanded(press, session));
    return session;
  };
}

/** One press of Send, held under its turn so a stop of it follows it. */
export function threadSendPressed(
  press: ThreadSendPress,
): ThreadSendsThunk<Promise<ThreadSendPressEnded>> {
  return async (dispatch, getState, extra) => {
    const { home, text, attached } = press;
    const carried = extra.threadSends;
    const name = threadSendRecordName(home, press.session);
    const { held } = threadSendAt(getState(), name);
    const turn =
      threadTurnRetained(
        held === undefined
          ? undefined
          : { ...held, attached: carried.images.get(held.turn) ?? [] },
        { text, attached },
      ) ?? threadTurnMinted(drawBytes(threadTurnIdBytesCount));
    const sent = { turn, text };
    dispatch(threadSendBeganAt({ name, sent }));
    if (press.session === undefined && home.scope === "Project")
      dispatch(chatPaneStartingAt(home.partition));
    let back = false;
    const said = (send: ThreadSend): void => {
      const away = press.drawn?.() !== true;
      if (send.send !== "Sent") carried.images.set(turn, attached);
      dispatch(threadSendEndedAt({ name, sent, send, away }));
      threadSendImagesPruned(getState().threadSends, carried);
      back = send.send !== "Sent" && !away;
    };
    const flight = dispatch(threadSendRun(press, name, sent, said));
    const started = await threadStopFlown(carried.flights, turn, flight);
    return {
      back,
      started: press.session === undefined ? started : undefined,
    };
  };
}

/** The thread a stop with no send on its way goes to: the record's own, the
 * one a first box's open answered, or the one its message opened while the
 * pane awaits its read. */
function threadStopTo(
  state: {
    readonly threadSends: ThreadSendRecords;
    readonly chatPanes: ChatPanesHeld;
  },
  home: ThreadHome,
  session: string | undefined,
): string | undefined {
  const name = threadSendRecordName(home, session);
  const standing = session ?? threadSendAt(state, name).opened;
  if (standing !== undefined || home.scope === "Member") return standing;
  return chatPaneRecordAt(state, home.partition).opening;
}

/** One press of Stop: on the thread its send reaches where that is on its
 * way, and otherwise on the record's own thread. It answers once the door has,
 * or once there is nothing to ask it. */
export function threadStopPressed(stop: {
  readonly home: ThreadHome;
  readonly session: string | undefined;
  readonly turn: string;
}): ThreadSendsThunk<Promise<void>> {
  return async (dispatch, getState, extra) => {
    const { home, turn } = stop;
    const name = threadSendRecordName(home, stop.session);
    const to = threadStopTo(getState(), home, stop.session);
    dispatch(threadStoppingAt({ name, turn }));
    const reached = await (extra.threadSends.flights.get(turn) ??
      Promise.resolve(to));
    if (reached === undefined) {
      dispatch(threadStopBackAt({ name, turn, stop: undefined }));
      return;
    }
    const answered = threadStopFrom(
      await apiStopThreadTurnAt(extra.ports, home, reached, turn),
    );
    if (answered.stop === "Ended") return;
    dispatch(threadStopBackAt({ name, turn, stop: answered }));
  };
}

/** A record written as `written` says, and the images it no longer names let
 * go. */
function threadSendLetGo(written: UnknownAction): ThreadSendsThunk<void> {
  return (dispatch, getState, extra) => {
    dispatch(written);
    threadSendImagesPruned(getState().threadSends, extra.threadSends);
  };
}

/** A box holds what was kept for it. */
export function threadSendKeptTaken(name: string): ThreadSendsThunk<void> {
  return threadSendLetGo(threadSendTakenAt({ name }));
}

/** What was kept for a thread that takes nothing more goes. */
export function threadSendKeptClosed(name: string): ThreadSendsThunk<void> {
  return threadSendLetGo(threadSendClosedAt({ name }));
}

/** What was kept for each thread a listing says takes nothing more goes,
 * whether or not the thread is drawn. */
export function threadSendKeptListed(
  home: ThreadHome,
  threads: readonly Pick<ThreadEntryResponse, "session" | "state">[],
): ThreadSendsThunk<void> {
  return (dispatch, getState) => {
    for (const thread of threads) {
      const name = threadSendRecordName(home, thread.session);
      const record = threadSendAt(getState(), name);
      if (threadKeptClosed(record, threadTakesMessages(thread)))
        dispatch(threadSendKeptClosed(name));
    }
  };
}

/** A first box went. */
export function threadSendFirstGone(name: string): ThreadSendsThunk<void> {
  return threadSendLetGo(threadSendFirstLeftAt({ name }));
}

/** The images a kept message's turns carried, in order. */
export function threadSendKeptAttached(
  turns: readonly string[],
): ThreadSendsThunk<readonly ConversationAttachment[]> {
  return (_dispatch, _getState, extra) =>
    turns.flatMap((turn) => extra.threadSends.images.get(turn) ?? []);
}
