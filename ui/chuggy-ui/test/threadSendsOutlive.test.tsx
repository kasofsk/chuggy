/**
 * What a press ends as outlives the box it was pressed in: the pane collapsed
 * and expanded through its own controls, and a thread's own page left for
 * another screen, each unmounting the box for real under one store.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ChatPane } from "../app/browser/shell/ChatPane.tsx";
import { useChatPane } from "../app/browser/shell/chatPaneHeld.ts";
import type { ConsoleStore } from "../app/browser/store.ts";
import { ThreadPage } from "../app/browser/ThreadPage.tsx";
import { consoleStoreBare } from "./consoleStoreBare.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { Routed } from "./routed.tsx";
import { answer, ScreenHarness, settled } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { streamServer } from "./streamDouble.ts";
import { styleless } from "./styleless.ts";
import { threadBody, threadEntry, threadPartition } from "./threadFixture.ts";
import {
  stageAnswered,
  stageBox,
  stageButton,
  stageColumn,
  stageDoor,
  stageLiveOpening,
  stageProjectOpening,
  stageSent,
} from "./threadStopStage.tsx";
import type { StageDoors } from "./threadStopStage.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const held = "thread-held";
const opened = "thread-new";
const words = "where does 41 stand";
const refusal = { error: { code: "Invalid" } };

/** What a case holds of its doors beyond a stage's: each open, held until the
 * case answers it where `opensHeld` says so, the key each asked under, and
 * how many images were uploaded. */
interface Site extends StageDoors {
  readonly opens: ((response: Response) => void)[];
  readonly keys: unknown[];
  readonly uploads: number[];
}

/** A reader whose listing holds `listed`, each read open and streamless, and
 * whose opens answer `opened`, at once unless `opensHeld`. */
function siteStubbed(listed: readonly string[], opensHeld = false): Site {
  const site: Site = {
    batches: [[]],
    sends: [],
    stops: [],
    opens: [],
    keys: [],
    uploads: [],
  };
  const door = stageDoor(site, (url, method) => {
    if (url.pathname.endsWith("/artifacts")) {
      site.uploads.push(site.uploads.length + 1);
      return answer(
        { artifact: `artifact-${String(site.uploads.length)}`, digest: "d" },
        201,
      );
    }
    if (url.pathname.endsWith("/threads") && method === "POST")
      return new Promise<Response>((answered) => {
        site.opens.push(answered);
        if (!opensHeld)
          answered(answer(threadEntry({ session: opened, mine: true }), 201));
      });
    if (url.pathname.endsWith("/threads"))
      return answer({
        threads: listed.map((session) =>
          threadEntry({ session, mine: true, title: session }),
        ),
      });
    const read = [...listed, opened].find((session) =>
      url.pathname.endsWith(`/threads/${session}`),
    );
    if (read === undefined) return undefined;
    return answer(threadBody({ session: read, streamless: true, turns: [] }));
  });
  vi.stubGlobal("fetch", (address: string, init?: RequestInit) => {
    if (init?.method === "POST" && address.endsWith("/threads"))
      site.keys.push(
        JSON.parse(typeof init.body === "string" ? init.body : "{}"),
      );
    return door(address, init);
  });
  return site;
}

/** The pane as the shell draws it, from the hold its controls move. */
function PaneHeld(): ReactNode {
  const pane = useChatPane();
  return <ChatPane partition={threadPartition} chat={pane.state} />;
}

type Screen = "Pane" | "Page" | "Elsewhere";

interface Drawn {
  readonly to: (shown: Screen) => Promise<void>;
}

/** One tab drawing `shown` under one store and client, which every screen it
 * moves to keeps, under `StrictMode` where `strict` says, as `main.tsx` draws
 * the console. */
async function drawn(shown: Screen, strict = false): Promise<Drawn> {
  const server = streamServer([stageProjectOpening], "token", [
    stageLiveOpening(),
    stageLiveOpening(),
    stageLiveOpening(),
  ]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const store: ConsoleStore = consoleStoreBare(client);
  const tree = (at: Screen): ReactNode => (
    <ScreenHarness
      partition={threadPartition}
      client={client}
      transport={server.ports.fetch}
      store={store}
    >
      <Routed>
        {at === "Pane" ? <PaneHeld /> : null}
        {at === "Page" ? (
          <ThreadPage partition={threadPartition} session={held} />
        ) : null}
        {at === "Elsewhere" ? <p>Elsewhere</p> : null}
      </Routed>
    </ScreenHarness>
  );
  const view = render(tree(shown), { reactStrictMode: strict });
  await settled();
  return {
    to: async (at) => {
      view.rerender(tree(at));
      await settled();
    },
  };
}

async function pressed(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
  await settled();
}

const collapsed = (): Promise<void> => pressed("Collapse");

const expanded = (): Promise<void> => pressed("Expand chat");

function shot(bytes: readonly number[]): File {
  return new File([new Uint8Array(bytes)], "shot", { type: "image/png" });
}

async function attached(file: File): Promise<void> {
  fireEvent.paste(stageBox(), {
    clipboardData: { files: [file], types: ["Files"] },
  });
  await waitFor(() => {
    expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
  });
}

/** The box pressed again with what it holds. */
async function pressedAgain(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(stageBox(), { key: "Enter" });
    await Promise.resolve();
  });
  await settled();
}

test("a message refused after the pane collapsed is back in the box on expanding, with its images and its note, and pressed again unchanged reaches the same turn", async () => {
  const site = siteStubbed([held]);
  await drawn("Pane");
  await attached(shot([1, 2, 3]));
  await stageSent(words);
  await settled();
  expect(site.sends.map((sent) => sent.session)).toStrictEqual([held]);

  await collapsed();
  await stageAnswered(site.sends[0], refusal, 400);
  await expanded();
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);

  await pressedAgain();
  expect(site.sends).toHaveLength(2);
  expect(site.sends[1]?.turn).toBe(site.sends[0]?.turn);
});

test("a message refused after its thread's own page was left is back in the box when the page is returned to, and reaches the same turn", async () => {
  const site = siteStubbed([held]);
  const tab = await drawn("Page");
  await stageSent(words);
  await settled();

  await tab.to("Elsewhere");
  await stageAnswered(site.sends[0], refusal, 400);
  await tab.to("Page");
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);

  await pressedAgain();
  expect(site.sends.map((sent) => sent.turn)).toStrictEqual([
    site.sends[0]?.turn,
    site.sends[0]?.turn,
  ]);
});

test("a first message refused with the pane collapsed is back in the box on expanding, and the next press opens no second thread", async () => {
  const site = siteStubbed([]);
  await drawn("Pane");
  await stageSent(words);
  await settled();
  expect(site.opens).toHaveLength(1);

  await collapsed();
  await stageAnswered(site.sends[0], refusal, 400);
  await expanded();
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);

  await pressedAgain();
  expect(site.opens).toHaveLength(1);
  expect(site.sends.map((sent) => sent.session)).toStrictEqual([
    opened,
    opened,
  ]);
});

test("a first message whose thread is listed, refused with the pane collapsed under StrictMode, is back in the box on expanding, and the next press opens no second thread", async () => {
  const listed: string[] = [];
  const site = siteStubbed(listed);
  await drawn("Pane", true);
  await stageSent(words);
  await settled();
  expect(site.opens).toHaveLength(1);
  listed.push(opened);

  await collapsed();
  await stageAnswered(site.sends[0], refusal, 400);
  await expanded();
  expect(stageBox().value).toBe(words);
  expect(screen.getAllByText("Not sent")).toHaveLength(1);

  await pressedAgain();
  expect(site.opens).toHaveLength(1);
  expect(site.sends.map((sent) => sent.session)).toStrictEqual([
    opened,
    opened,
  ]);
});

test("a first press whose open's answer was lost, pressed again after the pane collapsed and expanded, opens under the same key and one thread results", async () => {
  const site = siteStubbed([], true);
  await drawn("Pane");
  await stageSent(words);
  await settled();
  expect(site.opens).toHaveLength(1);

  await collapsed();
  await act(async () => {
    site.opens[0]?.(answer({ error: { code: "InternalError" } }, 500));
    await Promise.resolve();
  });
  await settled();
  await expanded();
  expect(stageBox().value).toBe(words);

  await pressedAgain();
  expect(site.opens).toHaveLength(2);
  await act(async () => {
    site.opens[1]?.(answer(threadEntry({ session: opened, mine: true }), 201));
    await Promise.resolve();
  });
  await settled();
  expect(
    site.keys[1],
    "the open after the lost answer drew a fresh key",
  ).toStrictEqual(site.keys[0]);
  expect(site.sends.map((sent) => sent.session)).toStrictEqual([opened]);
});

/** Whether a thread's conversation fills the pane, in place of the first
 * composer. */
function threadDrawn(): boolean {
  return document.querySelector("[role=region][data-fills-page]") !== null;
}

test("a first message whose thread opened but whose send was refused in view draws that thread after the pane collapsed and expanded, and the next message opens no second thread", async () => {
  const listed: string[] = [];
  const site = siteStubbed(listed);
  await drawn("Pane");
  await stageSent(words);
  await settled();
  expect(site.opens).toHaveLength(1);
  listed.push(opened);
  await stageAnswered(site.sends[0], refusal, 400);
  expect(stageBox().value).toBe(words);

  await collapsed();
  await expanded();
  await waitFor(() => {
    expect(threadDrawn()).toBe(true);
  });
  await stageSent(words);
  await settled();
  expect(site.opens).toHaveLength(1);
  expect(site.sends.map((sent) => sent.session)).toStrictEqual([
    opened,
    opened,
  ]);
});

test("a first message answered while the pane is collapsed is drawn in its thread on expanding, through the read of that thread", async () => {
  const site = siteStubbed([]);
  await drawn("Pane");
  await stageSent(words);
  await settled();

  await collapsed();
  const [sent] = site.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 1 }, 202);
  await expanded();
  await waitFor(() => {
    expect(threadDrawn()).toBe(true);
  });
  expect(stageBox().value).toBe("");
  expect(site.opens).toHaveLength(1);
});

test("a first message answered while the pane is collapsed under StrictMode is drawn in its thread on expanding", async () => {
  const site = siteStubbed([]);
  await drawn("Pane", true);
  await stageSent(words);
  await settled();

  await collapsed();
  const [sent] = site.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 1 }, 202);
  await expanded();
  await waitFor(() => {
    expect(threadDrawn()).toBe(true);
  });
  expect(site.opens).toHaveLength(1);
});

test("a send out when the pane collapsed is Stop once expanded, and its stop reaches that thread once the send has answered", async () => {
  const site = siteStubbed([held]);
  await drawn("Pane");
  await stageSent(words);
  await settled();

  await collapsed();
  await expanded();
  expect(stageColumn(document.body)).toContain(`> ${words}`);
  expect(stageButton()).toBe("Stop");
  await pressed("Stop");
  expect(site.stops, "the door knows no such turn yet").toStrictEqual([]);

  const [sent] = site.sends;
  await stageAnswered(sent, { turn: sent?.turn, ordinal: 1 }, 202);
  expect(site.stops.map((stop) => [stop.session, stop.turn])).toStrictEqual([
    [held, sent?.turn],
  ]);
});

test("a press in the pane is drawn on the same thread's own page, with its Stop", async () => {
  siteStubbed([held]);
  const tab = await drawn("Pane");
  await stageSent(words);
  await settled();

  await tab.to("Page");
  expect(stageColumn(document.body)).toContain(`> ${words}`);
  expect(stageButton()).toBe("Stop");
});
