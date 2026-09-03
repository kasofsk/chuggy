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
import { selectorProjectOverridesSchema } from "../../../src/contract/requests.ts";
import { selectorSettingsLimitNames } from "../app/core/selectorSettingsForm.ts";
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
    dispatchesPerDecision: 3,
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
  readonly writes: () => readonly unknown[];
}

interface SettingsInit {
  readonly method?: string;
  readonly body?: string;
}

/** The page over a server whose answer to the write the case decides, and whose
 * read the case may make carry overrides the form draws no box for. */
async function drawSettings(
  answering: () => { readonly body: unknown; readonly status: number },
  read: unknown = settingsBody(12, { northStar: "ship the console" }),
): Promise<SettingsServer> {
  const writes: unknown[] = [];
  const fetching = ((url: string, init?: SettingsInit) => {
    if (init?.method === "PUT") {
      writes.push(JSON.parse(init.body ?? "null"));
      const found = answering();
      return Promise.resolve(answer(found.body, found.status));
    }
    if (url.includes("/history"))
      return Promise.resolve(answer({ revisions: [] }));
    return Promise.resolve(answer(read));
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
  return { written: () => writes[writes.length - 1], writes: () => writes };
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

/**
 * The route replaces the whole override set, so an override this form draws no
 * box for is deleted by any save that does not carry it. Nothing on the page
 * shows an allowlist, so nothing on the page would show it going.
 */
test("an override the form draws no box for survives a save that edits another", async () => {
  const server = await drawSettings(
    () => ({ body: settingsBody(13, {}), status: 200 }),
    settingsBody(12, {
      northStar: "ship the console",
      modelAllowlist: ["claude-opus-4"],
      toolAllowlist: ["Read", "Grep"],
      operationalContextMaxAgeMs: 30_000,
    }),
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      modelAllowlist: ["claude-opus-4"],
      toolAllowlist: ["Read", "Grep"],
      operationalContextMaxAgeMs: 30_000,
      northStar: "ship the lead page",
    },
  });
});

/** Each box edits its own field. A handler naming another writes the typed text
 * into a setting nobody looked at and clears the one they were editing. */
test("typing in each box changes that box and no other", async () => {
  await drawSettings(() => ({ body: settingsBody(13, {}), status: 200 }));
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Base prompt"), {
      target: { value: "choose the oldest" },
    });
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("Base prompt").value).toBe(
    "choose the oldest",
  );
  expect(screen.getByLabelText<HTMLTextAreaElement>("North Star").value).toBe(
    "ship the console",
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("Base prompt").value).toBe(
    "choose the oldest",
  );
  expect(screen.getByLabelText<HTMLTextAreaElement>("North Star").value).toBe(
    "ship the lead page",
  );
});

/**
 * A write that landed is the newest read, and nothing else will tell the page
 * so: the route raises no frame and nothing refetches. A second save that
 * resent the revision the first one moved would be told by this same tab that
 * somebody else wrote — a dead end reachable by pressing Save twice.
 */
test("a second save is made against the revision the first one produced", async () => {
  let revision = 12;
  const server = await drawSettings(() => {
    revision += 1;
    return { body: settingsBody(revision, {}), status: 200 };
  });
  await turned(save);
  await settled();
  await turned(save);
  await settled();
  expect(
    server
      .writes()
      .map((body) => (body as { expectedRevision: number }).expectedRevision),
  ).toStrictEqual([12, 13]);
  expect(screen.getByText("Written · 14")).toBeDefined();
});

/** A conflict is not a dead end: the reader keeps what they typed and the next
 * save is made against the revision the route says stands. */
test("a save after a conflict is made against the revision that moved", async () => {
  let conflicting = true;
  const server = await drawSettings(() => {
    if (conflicting) {
      conflicting = false;
      return {
        body: {
          error: { code: "SettingsRevisionConflict", message: "moved" },
          settings: settingsBody(14, { toolAllowlist: ["Read"] }),
        },
        status: 409,
      };
    }
    return { body: settingsBody(15, {}), status: 200 };
  });
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(screen.getByText("Conflict · 14")).toBeDefined();
  expect(screen.getByLabelText<HTMLTextAreaElement>("North Star").value).toBe(
    "ship the lead page",
  );
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      toolAllowlist: ["Read"],
      northStar: "ship the lead page",
    },
  });
  expect(screen.getByText("Written · 15")).toBeDefined();
});

/**
 * THE CASE `expectedRevision` EXISTS FOR. This reader edits one limit and never
 * looks at the North Star; another administrator changes the North Star under
 * them. Carrying every drawn box forward would put this reader's stale copy of
 * that North Star back on the wire under a revision that by then matches, so
 * the route would accept it and the other write would be gone with nobody
 * having typed a word of it.
 */
test("a conflict does not carry a box this reader never touched", async () => {
  let conflicting = true;
  const server = await drawSettings(
    () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, {
              northStar: "somebody else's star",
              toolAllowlist: ["Read"],
            }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    settingsBody(12, { northStar: "the original star" }),
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Tokens"), {
      target: { value: "500" },
    });
  });
  await turned(save);
  await settled();
  expect(screen.getByText("Conflict · 14")).toBeDefined();
  expect(screen.getByLabelText<HTMLTextAreaElement>("North Star").value).toBe(
    "somebody else's star",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Tokens").value).toBe("500");
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      toolAllowlist: ["Read"],
      northStar: "somebody else's star",
      limits: { tokensPerDecision: 500 },
    },
  });
});

/**
 * A read can move under an open form at any moment, including between a Save
 * click and its answer. A reseed there takes back text the reader typed while
 * they were waiting, which is the one window in which they cannot see it go.
 */
test("text typed while a save is in flight survives the answer", async () => {
  const server = await drawSettings(() => ({
    body: settingsBody(13, { northStar: "ship the console" }),
    status: 200,
  }));
  await turned(save);
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Base prompt"), {
      target: { value: "typed while the save was in flight" },
    });
  });
  await settled();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("Base prompt").value,
    "the answer to a save took back what was typed while it was in flight",
  ).toBe("typed while the save was in flight");
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { northStar: "ship the console" },
  });
});

/**
 * The same lost update, through a limit box rather than a text one. This reader
 * edits the North Star and never looks at Tokens; another administrator raises
 * Tokens under them. Carrying every limit forward would put this reader's stale
 * copy of the old ceiling back on the wire under a revision that by then
 * matches, and the route would take it.
 */
test("a conflict does not carry a limit this reader never touched", async () => {
  let conflicting = true;
  const server = await drawSettings(
    () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, {
              limits: { tokensPerDecision: 900_000, dispatchesPerDecision: 2 },
            }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    settingsBody(12, { limits: { tokensPerDecision: 100 } }),
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(screen.getByText("Conflict · 14")).toBeDefined();
  expect(screen.getByLabelText<HTMLInputElement>("Tokens").value).toBe(
    "900000",
  );
  expect(screen.getByLabelText<HTMLInputElement>("Dispatches").value).toBe("2");
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      northStar: "ship the lead page",
      limits: { tokensPerDecision: 900_000, dispatchesPerDecision: 2 },
    },
  });
});

/**
 * The boxes and the wire's own limit roster are one set, read from the schema
 * rather than listed again. A limit the wire admits and the form draws no box
 * for is not merely invisible: the write rebuilds the whole limit set from the
 * boxes, so the first edit to anything would drop it.
 */
test("the form draws a box for every limit the wire admits", () => {
  expect([...selectorSettingsLimitNames].sort()).toStrictEqual(
    Object.keys(
      (
        selectorProjectOverridesSchema.shape.limits.unwrap() as never as {
          readonly shape: Readonly<Record<string, unknown>>;
        }
      ).shape,
    ).sort(),
  );
});

test("a limit a project set survives a save that edits the North Star", async () => {
  const server = await drawSettings(
    () => ({ body: settingsBody(13, {}), status: 200 }),
    settingsBody(12, { limits: { dispatchesPerDecision: 2 } }),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Dispatches").value).toBe("2");
  await turned(() => {
    fireEvent.change(screen.getByLabelText("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the lead page",
      limits: { dispatchesPerDecision: 2 },
    },
  });
});

/**
 * THE DISPATCH BUDGET INHERITS THE WHOLE-SET REPLACE, and this is the direction
 * the other limit cases do not cover: the write is rebuilt from the boxes, so a
 * save that edits only this one carries every other override or deletes it. A
 * reader raising the budget would silently drop the project's North Star, its
 * allowlists and its other limits, and nothing on the page would show it go.
 */
test("editing only the dispatch budget leaves every other override in place", async () => {
  const server = await drawSettings(
    () => ({ body: settingsBody(13, {}), status: 200 }),
    settingsBody(12, {
      northStar: "ship the console",
      basePrompt: "choose the next ticket",
      mode: "Running",
      dispatchMode: "ApprovalRequired",
      modelAllowlist: ["claude-opus-4"],
      toolAllowlist: ["Read"],
      operationalContextMaxAgeMs: 30_000,
      limits: { tokensPerDecision: 100, dispatchesPerDecision: 2 },
    }),
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Dispatches"), {
      target: { value: "5" },
    });
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      basePrompt: "choose the next ticket",
      mode: "Running",
      dispatchMode: "ApprovalRequired",
      modelAllowlist: ["claude-opus-4"],
      toolAllowlist: ["Read"],
      operationalContextMaxAgeMs: 30_000,
      limits: { tokensPerDecision: 100, dispatchesPerDecision: 5 },
    },
  });
});

/**
 * THE DISPATCH BUDGET INHERITS THE EDITED-FIELDS REBASE. This reader raises the
 * budget and never looks at the North Star; another administrator changes the
 * North Star under them. The edited box keeps what was typed and every other
 * box takes what now stands, so the next save does not write this reader's
 * stale copy of somebody else's star back over it.
 */
test("a conflict keeps a typed dispatch budget and takes the rest", async () => {
  let conflicting = true;
  const server = await drawSettings(
    () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, {
              northStar: "somebody else's star",
              limits: { dispatchesPerDecision: 2 },
            }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    settingsBody(12, { limits: { dispatchesPerDecision: 1 } }),
  );
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Dispatches"), {
      target: { value: "5" },
    });
  });
  await turned(save);
  await settled();
  expect(screen.getByText("Conflict · 14")).toBeDefined();
  expect(
    screen.getByLabelText<HTMLInputElement>("Dispatches").value,
    "the rebase took back a budget this reader had typed",
  ).toBe("5");
  expect(screen.getByLabelText<HTMLTextAreaElement>("North Star").value).toBe(
    "somebody else's star",
  );
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      northStar: "somebody else's star",
      limits: { dispatchesPerDecision: 5 },
    },
  });
});

/**
 * THE CEILING IS THE ROUTE'S AND THE PAGE SHOWS WHAT THE ROUTE SAID. What a
 * decision may dispatch is bounded by the selector, and
 * `console-reaches-no-source` is why no copy of that bound can be here: a
 * second statement of it would refuse a budget the route takes, hiding a
 * setting an owner is entitled to, and would still not catch one the route
 * refuses. So the number is written as typed and the refusal is the one line
 * the page says.
 */
const dispatchesPastTheCeiling = 99;

test("a dispatch budget the route refuses is drawn and not judged here", async () => {
  const server = await drawSettings(() => ({
    body: {
      error: { code: "InvalidRequest", message: "The request is invalid." },
    },
    status: 400,
  }));
  await turned(() => {
    fireEvent.change(screen.getByLabelText("Dispatches"), {
      target: { value: String(dispatchesPastTheCeiling) },
    });
  });
  expect(
    screen.getByLabelText("Dispatches").getAttribute("aria-invalid"),
    "the form judged the ceiling itself instead of asking the route",
  ).toBe("false");
  expect(
    screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
  ).toBe(false);
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      limits: { dispatchesPerDecision: dispatchesPastTheCeiling },
    },
  });
  expect(
    screen.getByText(/^Failed · /).textContent,
    "the route refused the budget and the page did not say so",
  ).toContain("InvalidRequest");
});
