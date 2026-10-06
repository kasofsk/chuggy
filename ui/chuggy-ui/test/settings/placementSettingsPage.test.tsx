/**
 * The placement settings page: where the project's work and sessions run and
 * what decided it, read and edited behind one Edit.
 *
 * THE HOSTED ROUTE IS THE CASE WITH TEETH. The page may offer only what the
 * read says the reader may choose, so a reader the tenant has not granted
 * hosted runs is never shown the choice, and a write the grant refuses anyway
 * is said in the section rather than drawn as written.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { PlacementSettingsPage } from "../../app/browser/settings/PlacementSettingsPage.tsx";
import {
  answer,
  openedStream,
  press,
  ScreenHarness,
  scriptedFetch,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const granted = {
  work: { route: "InCluster", source: "Project" },
  evaluation: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
};

/** Chat on runners, where the reader's own is offline, and the lead hosted. */
const sessionsGranted = {
  thread: { route: "Pool", source: "Default" },
  lead: { route: "InCluster", source: "Override" },
  choices: ["InCluster", "Pool"],
  runners: { mine: "Offline", project: "Live" },
};

interface Drawing {
  readonly placement?: unknown;
  /** Read again at every read, so a case may move it under the page. */
  readonly sessions?: unknown;
  /** What a write answers, in the order the page makes them. */
  readonly written?: readonly Response[];
  readonly client?: QueryClient;
  /** Whether the session placement's read fails, which a case may set too. */
  readonly sessionsFailing?: boolean;
  /** What a session placement read waits on before it answers. */
  readonly sessionsHeld?: Promise<void> | undefined;
}

async function drawPage(
  drawing: Drawing = {},
): Promise<readonly SentRequest[]> {
  const placement: unknown = drawing.placement ?? granted;
  const sessions = (): unknown => drawing.sessions ?? sessionsGranted;
  const written = [...(drawing.written ?? [])];
  const scripted = scriptedFetch((request) => {
    if (request.method !== "GET") return written.shift() ?? answer({}, 503);
    if (request.url.endsWith("/session-placement"))
      return (drawing.sessionsHeld ?? Promise.resolve()).then(() =>
        drawing.sessionsFailing === true
          ? answer({ error: { code: "Unavailable" } }, 500)
          : answer(sessions()),
      );
    return answer(placement);
  });
  vi.stubGlobal("fetch", scripted.fetch);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={drawing.client ?? new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <PlacementSettingsPage />
    </ScreenHarness>,
  );
  await settled();
  return scripted.sent;
}

function offered(kind: string): readonly string[] {
  return within(screen.getByRole("radiogroup", { name: kind }))
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("value") ?? "");
}

async function choose(kind: string, name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: kind })).getByRole(
        "radio",
        { name },
      ),
    );
  });
}

function placementRows(): readonly (string | null)[] {
  return within(sectionOf("Placement"))
    .getAllByRole("row")
    .map((row) => row.textContent);
}

/** A session's runner is said only where it runs on runners: the lead here is
 * hosted, so its live runner says nothing. */
test("each kind is drawn with where it runs, what decided it, and a session's runner on runners", async () => {
  await drawPage();
  expect(placementRows()).toStrictEqual([
    "KindRuns onSet byRunner",
    "WorkHostedProject",
    "EvaluationHostedDeployment",
    "ChatRunnersDefaultOffline",
    "LeadHostedDeployment",
  ]);
});

/** Chat reads the reader's own runner and the lead any of the project's. */
test("chat says the reader's own runner and the lead the project's, one word each", async () => {
  await drawPage({
    sessions: {
      ...sessionsGranted,
      lead: { route: "Pool", source: "Project" },
      runners: { mine: "Unregistered", project: "Live" },
    },
  });
  expect(placementRows().slice(3)).toStrictEqual([
    "ChatRunnersDefaultNone",
    "LeadRunnersProjectLive",
  ]);
});

test("a reader the tenant granted hosted runs is offered both routes, and a save writes every kind", async () => {
  const sent = await drawPage({
    written: [
      answer({
        ...granted,
        evaluation: { route: "Pool", source: "Project" },
      }),
      answer({
        ...sessionsGranted,
        thread: { route: "InCluster", source: "Project" },
        lead: { route: "Pool", source: "Project" },
      }),
    ],
  });
  await press("Edit");
  expect(offered("Work")).toStrictEqual(["InCluster", "Pool"]);
  expect(offered("Chat")).toStrictEqual(["InCluster", "Pool"]);
  await choose("Evaluation", "Runners");
  await choose("Chat", "Hosted");
  await choose("Lead", "Runners");
  await press("Save changes");
  const wrote = sent.filter((one) => one.method === "PUT");
  expect(
    wrote.map((one) => [one.url.split("/").pop(), one.body]),
  ).toStrictEqual([
    ["execution-placement", { work: "InCluster", evaluation: "Pool" }],
    ["session-placement", { thread: "InCluster", lead: "Pool" }],
  ]);
  expect(screen.getByText("Written")).toBeTruthy();
  expect(placementRows()).toContain("EvaluationRunnersProject");
  expect(placementRows()).toContain("ChatHostedProject");
  expect(placementRows()).toContain("LeadRunnersProjectLive");
});

/** An administrator without the grant: work hosted and evaluation on runners,
 * chat and the lead hosted, and runners the one route they may choose. */
const grantless = {
  placement: {
    work: { route: "InCluster", source: "Project" },
    evaluation: { route: "Pool", source: "Project" },
    choices: ["Pool"],
  },
  sessions: {
    ...sessionsGranted,
    thread: { route: "InCluster", source: "Default" },
    lead: { route: "InCluster", source: "Project" },
    choices: ["Pool"],
  },
};

function puts(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((one) => one.method === "PUT")
    .map((one) => [one.url.split("/").pop(), one.body]);
}

function radio(kind: string, name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: kind })).getByRole(
    "radio",
    { name },
  );
}

/** A hosted kind the reader may not choose stays where it is, drawn as such,
 * and a save that moved nothing writes nothing. */
test("a reader without the hosted grant sees hosted kinds as they stand, and an untouched save writes nothing", async () => {
  const sent = await drawPage(grantless);
  await press("Edit");
  for (const kind of ["Work", "Chat", "Lead"]) {
    expect(offered(kind)).toStrictEqual(["InCluster", "Pool"]);
    expect(radio(kind, "Hosted").getAttribute("aria-checked")).toBe("true");
    expect(radio(kind, "Hosted").hasAttribute("disabled")).toBe(true);
    expect(radio(kind, "Runners").hasAttribute("disabled")).toBe(false);
  }
  expect(offered("Evaluation")).toStrictEqual(["Pool"]);
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([]);
  expect(screen.queryByText("Written")).toBeNull();
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
});

test("a reader without the hosted grant who moves work alone writes work's placement alone", async () => {
  const sent = await drawPage({
    ...grantless,
    written: [
      answer({
        ...grantless.placement,
        work: { route: "Pool", source: "Project" },
      }),
    ],
  });
  await press("Edit");
  await choose("Work", "Runners");
  expect(offered("Work")).toStrictEqual(["InCluster", "Pool"]);
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([
    ["execution-placement", { work: "Pool", evaluation: "Pool" }],
  ]);
  expect(screen.getByText("Written")).toBeTruthy();
  expect(placementRows()).toContain("ChatHostedDefault");
});

test("a reader who moves chat alone writes the session placement alone", async () => {
  const sent = await drawPage({
    written: [
      answer({
        ...sessionsGranted,
        thread: { route: "InCluster", source: "Project" },
      }),
    ],
  });
  await press("Edit");
  await choose("Chat", "Hosted");
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([
    ["session-placement", { thread: "InCluster", lead: "InCluster" }],
  ]);
  expect(screen.getByText("Written")).toBeTruthy();
});

/** A drawing a case moves under the page while its editor is open. */
type Moving = Drawing & {
  sessions: unknown;
  sessionsFailing: boolean;
  sessionsHeld: Promise<void> | undefined;
};

/** The page with its editor open and `chosen` chosen in it, then `move` made
 * to what the server holds and the reads taken again, as a poll would. */
async function movedUnderEditor(
  drawing: Drawing,
  move: (moving: Moving) => void,
  chosen?: readonly [kind: string, route: string],
): Promise<readonly SentRequest[]> {
  const client = new QueryClient();
  const moving: Moving = {
    sessionsFailing: false,
    sessionsHeld: undefined,
    ...drawing,
    sessions: drawing.sessions ?? sessionsGranted,
    client,
  };
  const sent = await drawPage(moving);
  await press("Edit");
  if (chosen !== undefined) await choose(...chosen);
  move(moving);
  await turned(() => {
    void client.invalidateQueries();
  });
  await settled();
  return sent;
}

/** The session placement is polled, so it can move while the section is open,
 * and what the reader left alone is drawn and written as the newest read. */
test("a session placement moved under an open editor is not written back", async () => {
  const sent = await movedUnderEditor(
    {
      written: [
        answer({ ...granted, work: { route: "Pool", source: "Project" } }),
      ],
    },
    (moving) => {
      moving.sessions = {
        ...sessionsGranted,
        lead: { route: "Pool", source: "Project" },
      };
    },
  );
  await choose("Work", "Runners");
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([
    ["execution-placement", { work: "Pool", evaluation: "InCluster" }],
  ]);
});

test("a lead moved under an open editor is drawn where it moved, and a chat move writes it there", async () => {
  const sent = await movedUnderEditor(
    { written: [answer(sessionsGranted)] },
    (moving) => {
      moving.sessions = {
        ...sessionsGranted,
        lead: { route: "Pool", source: "Project" },
      };
    },
  );
  expect(radio("Lead", "Runners").getAttribute("aria-checked")).toBe("true");
  await choose("Chat", "Hosted");
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([
    ["session-placement", { thread: "InCluster", lead: "Pool" }],
  ]);
});

/** A reader without the grant cannot move the lead off the cluster by moving
 * chat: the write names the lead as an administrator who may set it left it. */
test("a lead moved to hosted under a grantless editor is written hosted when chat moves", async () => {
  const before = {
    ...grantless.sessions,
    lead: { route: "Pool", source: "Project" },
  };
  const sent = await movedUnderEditor(
    {
      placement: grantless.placement,
      sessions: before,
      written: [answer(before)],
    },
    (moving) => {
      moving.sessions = {
        ...before,
        lead: { route: "InCluster", source: "Project" },
      };
    },
  );
  await choose("Chat", "Runners");
  await press("Save changes");
  expect(puts(sent)).toStrictEqual([
    ["session-placement", { thread: "Pool", lead: "InCluster" }],
  ]);
});

/** A poll is asked on a clock, so one that fails says nothing of the placement
 * and the open editor keeps what the reader chose in it. */
test("a session placement poll that fails leaves the open editor and the reader's moves", async () => {
  await movedUnderEditor(
    {},
    (moving) => {
      moving.sessionsFailing = true;
    },
    ["Chat", "Hosted"],
  );
  expect(radio("Chat", "Hosted").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
});

/** A read asked before a save answers the placement the save replaced, so it
 * is cancelled rather than let land over the save. */
test("a session placement read in flight at a save does not draw over it", async () => {
  let answered = (): void => undefined;
  const sent = await movedUnderEditor(
    {
      written: [
        answer({
          ...sessionsGranted,
          thread: { route: "InCluster", source: "Project" },
        }),
      ],
    },
    (moving) => {
      moving.sessionsHeld = new Promise((resolve) => {
        answered = resolve;
      });
    },
    ["Chat", "Hosted"],
  );
  await press("Save changes");
  await turned(answered);
  await settled();
  expect(puts(sent)).toHaveLength(1);
  expect(placementRows()).toContain("ChatHostedProject");
});

test("a write the hosted grant refuses says so and stays open", async () => {
  await drawPage({
    written: [answer({ error: { code: "HostedRunsNotGranted" } }, 403)],
  });
  await press("Edit");
  await choose("Work", "Runners");
  await press("Save changes");
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  expect(screen.queryByText("Work and evaluation saved")).toBeNull();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
});

/** The sessions are written second, so their refusal stops the save there,
 * and the placement written before it stands. */
test("a session write the hosted grant refuses says so and stays open after work's landed", async () => {
  const sent = await drawPage({
    written: [
      answer(granted),
      answer({ error: { code: "HostedRunsNotGranted" } }, 403),
    ],
  });
  await press("Edit");
  await choose("Work", "Runners");
  await choose("Chat", "Hosted");
  await press("Save changes");
  expect(puts(sent)).toHaveLength(2);
  expect(screen.getByText("Needs hosted runs")).toBeTruthy();
  expect(screen.getByText("Work and evaluation saved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
});

test("a reader who may choose nothing is given no Edit to press", async () => {
  await drawPage({
    placement: { ...granted, choices: [] },
    sessions: { ...sessionsGranted, choices: [] },
  });
  expect(
    screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled"),
  ).toBe(true);
});
