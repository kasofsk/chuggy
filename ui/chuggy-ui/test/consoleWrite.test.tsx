/**
 * A console write outlives the screen that made it: a refusal whose screen was
 * left is drawn once, as a toast, and one whose screen is still there is that
 * screen's own line and no toast; a screen that comes back while the write is
 * in flight draws it as pending; and a write is sent once, whatever it answers.
 *
 * Drawn over the owner fallback's section, which is the plainest write the
 * console has, beside the toasts the shell mounts once.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import type { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ConsoleWriteToasts } from "../app/browser/consoleWrite.tsx";
import { OwnerFallbackSection } from "../app/browser/settings/OwnerFallbackSection.tsx";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
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
import { leadPartition } from "./leadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sectionTitle = "Personal runners";

/** The sentence the section draws for the refusal every case is answered. */
const refusedSentence = /^Failed · /u;

interface Drawn {
  readonly view: RenderResult;
  readonly sent: readonly SentRequest[];
  /** The section drawn or left, the toasts staying mounted either way. */
  readonly shown: (shown: boolean) => Promise<void>;
}

/** The section and the toasts under one cache, every write answered by
 * `written` and every read by an administered fallback of `Strict`. */
async function drawn(
  client: QueryClient,
  written: () => Response | Promise<Response>,
): Promise<Drawn> {
  const scripted = scriptedFetch((request) =>
    request.method === "GET"
      ? answer({ fallback: "Strict", administers: true })
      : written(),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const tree = (shown: boolean): ReactNode => (
    <ScreenHarness
      partition={leadPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      {shown ? <OwnerFallbackSection partition={leadPartition} /> : null}
      <ConsoleWriteToasts />
    </ScreenHarness>
  );
  const view = render(tree(true));
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

/** Preferred chosen and saved, which is one write. */
async function saved(): Promise<void> {
  await pressInSection("Edit");
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: sectionTitle })).getByRole(
        "radio",
        { name: "Preferred" },
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

test("a screen drawn again while its write is in flight draws it pending, then answered", async () => {
  const held = heldAnswer();
  const page = await drawn(consoleQueryClient(), () => held.answered);
  await saved();
  await page.shown(false);
  await page.shown(true);

  expect(within(sectionOf(sectionTitle)).getByText("Writing")).toBeDefined();

  await turned(() => {
    held.release(answer({ fallback: "Preferred", administers: true }));
  });
  await settled();

  expect(within(sectionOf(sectionTitle)).getByText("Written")).toBeDefined();
  expect(within(sectionOf(sectionTitle)).getByText("Preferred")).toBeDefined();
  expect(writesSent(page.sent)).toBe(1);
  expect(toastLines()).toStrictEqual([]);
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
