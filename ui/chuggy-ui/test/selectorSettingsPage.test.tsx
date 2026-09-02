/**
 * The North Star editor: what the project sets for itself, what the
 * installation gives it otherwise, and what a write the revision moved under
 * does.
 *
 * THE CONFLICT CASE IS THE ONE WITH TEETH. The settings are written whole, so
 * a write carrying no `expectedRevision` — or one that retried past a refusal —
 * would silently drop somebody else's North Star; the route answers `409` with
 * the settings that moved, and the page names that revision and stops.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { SelectorSettingsPage } from "../app/browser/SelectorSettingsPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
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

const effective = {
  revision: 12,
  projectRevision: 12,
  mode: "Running",
  installationMode: "Running",
  dispatchMode: "Automatic",
  basePrompt: "choose the next ticket",
  northStar: "ship the console",
  modelAllowlist: [],
  toolAllowlist: [],
  limits: {
    tokensPerDecision: 200_000,
    millisecondsPerDecision: 900_000,
    toolCallsPerDecision: 40,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 4,
    concurrentDecisions: 2,
    selectionsPerMinute: 6,
  },
  operationalContextMaxAgeMs: 60_000,
};

function settingsBody(revision: number, overrides: unknown): unknown {
  return {
    partition: leadPartition,
    revision,
    overrides,
    effective: { ...effective, revision, projectRevision: revision },
  };
}

interface SettingsServer {
  readonly written: () => unknown;
}

interface SettingsInit {
  readonly method?: string;
  readonly body?: string;
}

/** The page over a server whose answer to the write the case decides. */
async function drawSettings(
  answering: () => { readonly body: unknown; readonly status: number },
): Promise<SettingsServer> {
  let written: unknown;
  const fetching = ((url: string, init?: SettingsInit) => {
    if (init?.method === "PUT") {
      written = JSON.parse(init.body ?? "null");
      const found = answering();
      return Promise.resolve(answer(found.body, found.status));
    }
    if (url.includes("/history"))
      return Promise.resolve(answer({ revisions: [] }));
    return Promise.resolve(
      answer(settingsBody(12, { northStar: "ship the console" })),
    );
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <SelectorSettingsPage />
    </ScreenHarness>,
  );
  await settled();
  return { written: () => written };
}

function save(): void {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

test("the project's own overrides are the boxes, and the rest stand in", async () => {
  await drawSettings(() => ({ body: {}, status: 200 }));
  const northStar = screen.getByLabelText<HTMLTextAreaElement>("North Star");
  expect(northStar.value).toBe("ship the console");
  const basePrompt = screen.getByLabelText<HTMLTextAreaElement>("Base prompt");
  expect(basePrompt.value).toBe("");
  expect(basePrompt.placeholder).toBe("choose the next ticket");
  expect(screen.getByLabelText<HTMLInputElement>("Tokens").placeholder).toBe(
    "200000",
  );
});

/** The write is the whole override set under the revision the form was seeded
 * at, which is what makes a concurrent write a conflict and not a clobber. */
test("saving writes every override whole, under the revision it was read at", async () => {
  const server = await drawSettings(() => ({
    body: settingsBody(13, { northStar: "ship the lead page" }),
    status: 200,
  }));
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { northStar: "ship the lead page" },
  });
  expect(screen.getByText("Written · 13")).toBeDefined();
});

test("a revision that moved under the write is named and not retried", async () => {
  const server = await drawSettings(() => ({
    body: {
      error: {
        code: "SettingsRevisionConflict",
        message: "the selector settings moved under this write",
      },
      settings: settingsBody(14, { northStar: "somebody else's star" }),
    },
    status: 409,
  }));
  await turned(save);
  await settled();
  expect(screen.getByText("Conflict · 14")).toBeDefined();
  expect(
    (server.written() as { readonly expectedRevision: number })
      .expectedRevision,
  ).toBe(12);
});

test("a limit the wire will not take marks its own box and blocks the save", async () => {
  await drawSettings(() => ({ body: {}, status: 200 }));
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Tokens"), {
      target: { value: "many" },
    });
  });
  expect(screen.getByLabelText("Tokens").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
  ).toBe(true);
});
