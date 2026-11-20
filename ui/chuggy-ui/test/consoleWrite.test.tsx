/**
 * A console write outlives the screen that made it: a refusal whose screen was
 * left is drawn once, as a toast, and one whose screen is still there is that
 * screen's own line and no toast; a screen that comes back while the write is
 * in flight draws it as pending; a write is sent once, whatever it answers;
 * and a write that says its landing says it as a success toast, whether or
 * not its screen is still drawn, while one that says none toasts nothing.
 *
 * Drawn over the placement settings, a write of evaluation's route alone,
 * beside the toasts the shell mounts once.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  ConsoleWriteToasts,
  useConsoleWrite,
} from "../app/browser/consoleWrite.tsx";
import { PlacementSettingsPage } from "../app/browser/settings/PlacementSettingsPage.tsx";
import {
  consoleQueryClient,
  consoleWriteKey,
  consoleWriteWatchOf,
} from "../app/core/consoleWrite.ts";
import type { ConsoleWrite } from "../app/core/consoleWrite.ts";
import { TicketCreationRefused } from "../app/core/ticketCreationRefused.ts";
import {
  answer,
  heldAnswer,
  openedStream,
  ScreenHarness,
  scriptedFetch,
  sectionOf,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { projectPartition } from "./projectFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { renderCopied } from "./copied.tsx";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...projectPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sectionTitle = "Placement";

const placement = {
  work: { route: "Pool", source: "Project" },
  evaluation: { route: "Pool", source: "Project" },
  choices: ["Pool", "InCluster"],
};

/** The placement once evaluation is written hosted. */
const placementWritten = {
  ...placement,
  evaluation: { route: "InCluster", source: "Project" },
};

const sessions = {
  thread: { route: "Pool", source: "Default" },
  lead: { route: "InCluster", source: "Default" },
  leadOffering: "Own",
  leadOfferings: ["Own"],
  choices: ["InCluster", "Pool"],
  runners: { mine: "Live", project: "Unregistered" },
};

/** The sentence the section draws for the refusal every case is answered. */
const refusedSentence = "Server error";

interface Drawn {
  readonly view: RenderResult;
  readonly sent: readonly SentRequest[];
  /** The section drawn or left, the toasts staying mounted either way. */
  readonly shown: (shown: boolean) => Promise<void>;
}

/** The section and the toasts under one cache, every write answered by
 * `written` and every read as the placement on runners. */
async function drawn(
  client: QueryClient,
  written: () => Response | Promise<Response>,
): Promise<Drawn> {
  const scripted = scriptedFetch((request) =>
    request.method !== "GET"
      ? written()
      : answer(
          request.url.endsWith("/session-placement") ? sessions : placement,
        ),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const tree = (shown: boolean): ReactNode => (
    <ScreenHarness
      partition={projectPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      {shown ? <PlacementSettingsPage /> : null}
      <ConsoleWriteToasts />
    </ScreenHarness>
  );
  const view = renderCopied(tree(true));
  await settled();
  return {
    view,
    sent: scripted.sent,
    shown: async (shown) => {
      await turned(() => {
        view.rerender(tree(shown));
      });
      await settled();
    },
  };
}

async function pressInSection(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(sectionOf(sectionTitle)).getByRole("button", { name }),
    );
  });
}

/** Evaluation moved to hosted runs and saved, which is one write. */
async function saved(): Promise<void> {
  await pressInSection("Edit");
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Evaluation" })).getByRole(
        "radio",
        { name: "Hosted runs" },
      ),
    );
  });
  await pressInSection("Save changes");
}

function toastLines(): readonly (string | null)[] {
  return [...document.querySelectorAll(".toast-line")].map(
    (line) => line.textContent,
  );
}

function writesSent(sent: readonly SentRequest[]): number {
  return sent.filter((request) => request.method === "PUT").length;
}

test("a refusal arriving after its screen was left is drawn as one toast", async () => {
  const held = heldAnswer();
  const page = await drawn(consoleQueryClient(), () => held.answered);
  await saved();
  await page.shown(false);

  await turned(() => {
    held.release(answer({ error: { code: "Fault" } }, 500));
  });
  await settled();

  const lines = toastLines();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(refusedSentence);
});

test("a refusal on a screen still drawn is its own line and no toast", async () => {
  const held = heldAnswer();
  await drawn(consoleQueryClient(), () => held.answered);
  await saved();

  await turned(() => {
    held.release(answer({ error: { code: "Fault" } }, 500));
  });
  await settled();

  expect(
    within(sectionOf(sectionTitle)).getByText(refusedSentence),
  ).toBeDefined();
  expect(toastLines()).toStrictEqual([]);
});

test("a screen drawn again while its write is in flight draws it pending, then its landing's toast", async () => {
  const held = heldAnswer();
  const page = await drawn(consoleQueryClient(), () => held.answered);
  await saved();
  await page.shown(false);
  await page.shown(true);

  expect(within(sectionOf(sectionTitle)).getByText("Saving…")).toBeDefined();

  await turned(() => {
    held.release(answer(placementWritten));
  });
  await settled();

  expect(within(sectionOf(sectionTitle)).queryByText("Saving…")).toBeNull();
  expect(
    within(sectionOf(sectionTitle)).getByText("Hosted runs", {
      selector: "td span",
    }),
  ).toBeDefined();
  expect(writesSent(page.sent)).toBe(1);
  expect(toastLines()).toStrictEqual(["Placement saved"]);
});

test("a write the server faulted on is sent once", async () => {
  const page = await drawn(consoleQueryClient(), () =>
    answer({ error: { code: "Fault" } }, 500),
  );
  await saved();
  await settled();

  expect(
    within(sectionOf(sectionTitle)).getByText(refusedSentence),
  ).toBeDefined();
  expect(writesSent(page.sent)).toBe(1);
});

test("a refusal's code follows its sentence in its line, in the document without a hover", async () => {
  await drawn(consoleQueryClient(), () =>
    answer({ error: { code: "Fault" } }, 500),
  );
  await saved();
  await settled();

  const line = within(sectionOf(sectionTitle)).getByText(refusedSentence);
  expect(line.closest(".notice")?.textContent).toBe(
    `${refusedSentence} · Fault`,
  );
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a refusal's code follows its sentence in its toast", async () => {
  const held = heldAnswer();
  const page = await drawn(consoleQueryClient(), () => held.answered);
  await saved();
  await page.shown(false);
  await turned(() => {
    held.release(answer({ error: { code: "Fault" } }, 500));
  });
  await settled();

  expect(toastLines()).toStrictEqual([`${refusedSentence} · Fault`]);
});

test("a creation refused for its held draft's failed read says that read's code in its toast", async () => {
  const client = consoleQueryClient();
  renderCopied(
    <ScreenHarness
      partition={projectPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <ConsoleWriteToasts />
    </ScreenHarness>,
  );
  const sentence = "Draft · Not read · Server error";
  await turned(() => {
    consoleWriteWatchOf(client).refused(
      undefined,
      new TicketCreationRefused(sentence, {
        created: "Refused",
        reason: sentence,
        held: undefined,
        unread: { outcome: "Fault", code: "InternalError", status: 500 },
      }),
      undefined,
    );
  });

  expect(toastLines()).toStrictEqual([`${sentence} · InternalError`]);
});

/** A write answering `7` once released, saying `ticket-authoring-edit-saved`
 * of its landing where `says`. */
function landingWrite(
  released: Promise<void>,
  says: boolean,
): ConsoleWrite<undefined, number> {
  return {
    mutationKey: consoleWriteKey("landing"),
    write: async () => {
      await released;
      return { outcome: "Ok", value: 7 };
    },
    refusal: () => ({ id: "api-reason-failed" }),
    ...(says
      ? {
          landedUnseen: (ticket: number) => ({
            id: "ticket-authoring-edit-saved" as const,
            args: { ticket },
          }),
        }
      : {}),
  };
}

function LandingPress(props: {
  readonly write: ConsoleWrite<undefined, number>;
}): ReactNode {
  const writing = useConsoleWrite(props.write, { drawn: true });
  return (
    <button
      type="button"
      onClick={() => {
        writing.mutate(undefined);
      }}
    >
      Send
    </button>
  );
}

/** The press drawn beside the toasts, pressed, its screen left, and its
 * write then answered. */
async function landedLeft(says: boolean): Promise<void> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = landingWrite(released, says);
  const client = consoleQueryClient();
  const harnessed = (shown: boolean): ReactNode => (
    <ScreenHarness
      partition={projectPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      {shown ? <LandingPress write={write} /> : null}
      <ConsoleWriteToasts />
    </ScreenHarness>
  );
  const view = renderCopied(harnessed(true));
  await settled();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await turned(() => {
    view.rerender(harnessed(false));
  });
  await turned(() => {
    release();
  });
  await settled();
}

test("a write that says its landing is a success toast once it lands, its screen left", async () => {
  await landedLeft(true);

  expect(toastLines()).toStrictEqual(["Ticket 7 saved"]);
  expect(document.querySelector(".toast")?.getAttribute("data-tone")).toBe(
    "Success",
  );
});

test("a write that says nothing of its landing toasts nothing", async () => {
  await landedLeft(false);

  expect(toastLines()).toStrictEqual([]);
});
