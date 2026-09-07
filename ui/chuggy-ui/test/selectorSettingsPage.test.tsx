/**
 * The selector settings page: what the project runs under, the section a reader
 * opens one at a time, and what a write the revision moved under does.
 *
 * THE CONFLICT CASE IS THE ONE WITH TEETH. The settings are written whole, so a
 * write carrying no `expectedRevision` — or one that retried past a refusal —
 * would silently drop somebody else's North Star; the route answers `409` with
 * the settings that moved, and the section names that revision and stops.
 *
 * EVERY WRITE HERE IS THE WHOLE OVERRIDE SET, so a case that presses one button
 * asserts the whole body: the strip, a section's Save and a Restore each carry
 * every override the page draws no box for or delete it.
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

import { SelectorSettingsPage } from "../app/browser/SelectorSettingsPage.tsx";
import { leadDispatchesMax } from "../../../src/contract/http.ts";
import { selectorProjectOverridesSchema } from "../../../src/contract/requests.ts";
import { selectorSettingsLimitNames } from "../app/core/selectorSettingsForm.ts";
import { selectorTextShownCharsMax } from "../app/browser/selector/SelectorTextSection.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { styleless } from "./styleless.ts";
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
  threadStandingRules: "- You act through your owner's own commands.",
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

function settingsBody(
  revision: number,
  overrides: unknown,
  resolved: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    partition: leadPartition,
    revision,
    overrides,
    effective: {
      ...effective,
      ...resolved,
      revision,
      projectRevision: revision,
    },
  };
}

function revisionBody(revision: number, overrides: unknown): unknown {
  return {
    revision,
    overrides,
    administrator: { kind: "member", subject: "geoff@vteng.io" },
    recordedAt: "2026-09-05T17:13:00.000Z",
  };
}

interface SettingsServer {
  readonly written: () => unknown;
  readonly writes: () => readonly unknown[];
  readonly reads: () => number;
}

interface SettingsInit {
  readonly method?: string;
  readonly body?: string;
}

interface SettingsScript {
  readonly answering?: () => {
    readonly body: unknown;
    readonly status: number;
  };
  readonly read?: unknown;
  readonly history?: unknown;
}

/** The page over a server whose answer to the write the case decides, whose
 * read the case may make carry overrides no section draws, and whose history
 * the case may fill. */
async function drawSettings(
  script: SettingsScript = {},
): Promise<SettingsServer> {
  const writes: unknown[] = [];
  let reads = 0;
  const read =
    script.read ?? settingsBody(12, { northStar: "ship the console" });
  const answering = script.answering ?? (() => ({ body: {}, status: 200 }));
  const fetching = ((url: string, init?: SettingsInit) => {
    if (init?.method === "PUT") {
      writes.push(JSON.parse(init.body ?? "null"));
      const found = answering();
      return Promise.resolve(answer(found.body, found.status));
    }
    if (url.includes("/history"))
      return Promise.resolve(answer(script.history ?? { revisions: [] }));
    reads += 1;
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
  return {
    written: () => writes[writes.length - 1],
    writes: () => writes,
    reads: () => reads,
  };
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

function edit(title: string): void {
  fireEvent.click(
    within(sectionOf(title)).getByRole("button", { name: "Edit" }),
  );
}

function save(): void {
  press("Save changes");
}

/** A box is reached by its role: the section around it answers to the same
 * name, because the card is labelled by the heading the box is named after. */
function box(name: string): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name });
}

test("the top bar names the revision the settings were read at", async () => {
  await drawSettings();
  const revision = screen.getByRole("heading", {
    name: "Selector",
  }).nextElementSibling;
  expect(revision?.textContent).toBe("Revision 12");
});

/** A section is read until its Edit is pressed: the text stands whole and there
 * is no box, which is what makes the page a settings page and not a form. */
test("a section is read until its Edit is pressed", async () => {
  await drawSettings();
  expect(screen.queryByRole("textbox", { name: "North Star" })).toBeNull();
  expect(within(sectionOf("North Star")).getByText("ship the console"));
  await turned(() => {
    edit("North Star");
  });
  expect(box("North Star").value).toBe("ship the console");
  styleless();
});

/** One section edits at a time, so the rest stay readable and there is never a
 * second Save on the page for a reader to press by mistake. */
test("opening one section closes Edit on every other", async () => {
  await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(
    1,
  );
  for (const other of screen.getAllByRole("button", { name: "Edit" }))
    expect(other.hasAttribute("disabled")).toBe(true);
});

/** The pill is the only thing on the page that says a setting is nobody's
 * choice, and it sits on the section whose whole value is inherited. */
test("a section on the installation's value carries the Default pill", async () => {
  await drawSettings();
  expect(within(sectionOf("North Star")).queryByText("Default")).toBeNull();
  expect(
    within(sectionOf("Standing rules")).getByText("Default"),
  ).toBeDefined();
});

/** Reset empties the box rather than writing, so the reader still sees what
 * they are about to give up and still has Cancel. */
test("Reset to default clears the box and marks the section as inherited", async () => {
  await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    press("Reset to default");
  });
  expect(box("North Star").value).toBe("");
  expect(within(sectionOf("North Star")).getByText("Default")).toBeDefined();
  await turned(save);
  await settled();
});

/** Cancel is not a save that writes the old value back: it takes the box back
 * to what the read gave and leaves the wire alone. */
test("Cancel takes the box back to the read and writes nothing", async () => {
  const server = await drawSettings();
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(() => {
    press("Cancel");
  });
  expect(server.writes()).toHaveLength(0);
  await turned(() => {
    edit("North Star");
  });
  expect(box("North Star").value).toBe("ship the console");
});

test("saving a section writes every override whole, under the read revision", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: settingsBody(13, { northStar: "ship the lead page" }),
      status: 200,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { northStar: "ship the lead page" },
  });
  expect(within(sectionOf("North Star")).getByText("Written · 13"));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});

/**
 * THE STRIP IS A WRITE, NOT A SETTING. Mode and Dispatch are operational, so
 * each has one press and no edit mode — and because the write replaces the whole
 * override set, that press has to carry every other override the project has.
 */
test("Pause writes the paused mode beside every other override", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, {
      northStar: "ship the console",
      toolAllowlist: ["Read"],
    }),
  });
  await turned(() => {
    press("Pause");
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      toolAllowlist: ["Read"],
      mode: "Paused",
    },
  });
});

/**
 * A PROJECT THAT WAS NEVER PAUSED OF ITS OWN MUST NOT ACQUIRE AN OVERRIDE BY
 * BEING RESUMED. Writing `Running` where the installation already runs pins the
 * project against an installation-wide pause it should have followed.
 */
test("Resume clears the override where the installation is running", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, { mode: "Paused" }, { mode: "Paused" }),
  });
  await turned(() => {
    press("Resume");
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {},
  });
});

/** Where the installation is paused, clearing would leave the project paused by
 * inheritance, so Resume writes the mode instead. */
test("Resume writes Running where the installation is paused", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, {}, { mode: "Paused", installationMode: "Paused" }),
  });
  await turned(() => {
    press("Resume");
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { mode: "Running" },
  });
});

test("Require approval writes the dispatch mode the other press undoes", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, {}),
  });
  await turned(() => {
    press("Require approval");
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { dispatchMode: "ApprovalRequired" },
  });
});

/** A limit is read in the unit a person states it in, and never in the wire's
 * own: nobody sets a decision's wall in milliseconds or its input in bytes. */
test("a limit is read in its own unit and its digits are not scaled", async () => {
  await drawSettings();
  const limits = sectionOf("Limits");
  expect(within(limits).getByText("200,000")).toBeDefined();
  expect(within(limits).getByText("15")).toBeDefined();
  expect(within(limits).getByText("min")).toBeDefined();
  expect(within(limits).getByText("MiB")).toBeDefined();
});

/** EVERY ROW CARRIES ITS OWN STATE. A pill on the section would say the whole
 * of Limits is inherited when five of six rows are. */
test("each limit row says for itself whether it is the installation's", async () => {
  await drawSettings({
    read: settingsBody(12, { limits: { dispatchesPerDecision: 3 } }),
  });
  const limits = sectionOf("Limits");
  expect(within(limits).getAllByText("Default")).toHaveLength(5);
  await turned(() => {
    edit("Limits");
  });
  expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1);
  expect(within(sectionOf("Limits")).getAllByText("Default")).toHaveLength(5);
});

/** The foot counts the rows a save will move, because a reader cannot see six
 * boxes and their read values at once. */
test("the foot counts the rows this draft would move", async () => {
  await drawSettings();
  await turned(() => {
    edit("Limits");
  });
  const foot = () => sectionOf("Limits").querySelector("footer.panel-foot");
  expect(foot()?.textContent).toContain("0changes");
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: "5" },
    });
  });
  expect(foot()?.textContent).toContain("1change");
  await turned(() => {
    fireEvent.change(box("Tokens"), {
      target: { value: "500" },
    });
  });
  expect(foot()?.textContent).toContain("2changes");
});

/** A row this draft moved is marked, so a reader scanning six rows sees which
 * two the count is about. */
test("a row this draft moved is marked and an untouched one is not", async () => {
  await drawSettings();
  await turned(() => {
    edit("Limits");
  });
  const rowOf = (label: string) =>
    screen.getByLabelText(label).closest(".selector-limit");
  expect(rowOf("Dispatches")?.hasAttribute("data-edited")).toBe(false);
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: "5" },
    });
  });
  expect(rowOf("Dispatches")?.hasAttribute("data-edited")).toBe(true);
  expect(rowOf("Tokens")?.hasAttribute("data-edited")).toBe(false);
});

/** A row's own Reset gives that ceiling back to the installation without
 * touching the five beside it. */
test("a row's Reset clears that override and no other", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, {
      limits: { dispatchesPerDecision: 3, tokensPerDecision: 100 },
    }),
  });
  await turned(() => {
    edit("Limits");
  });
  const [reset] = within(sectionOf("Limits")).getAllByRole("button", {
    name: "Reset",
  });
  if (reset === undefined) throw new Error("no overridden limit offered Reset");
  await turned(() => {
    fireEvent.click(reset);
  });
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: { limits: { dispatchesPerDecision: 3 } },
  });
});

test("a limit the wire will not take marks its own box and blocks the save", async () => {
  await drawSettings();
  await turned(() => {
    edit("Limits");
  });
  await turned(() => {
    fireEvent.change(box("Tokens"), {
      target: { value: "many" },
    });
  });
  expect(box("Tokens").getAttribute("aria-invalid")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "Save changes" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

/**
 * THE CEILING IS THE WIRE'S AND THE PAGE HOLDS NO COPY OF IT. What a decision
 * may dispatch is bounded by the override schema this form parses its draft
 * with, so a budget past it marks its own box exactly as an unreadable one
 * does — and the ceiling itself is admitted, which is the half a bound stated
 * one off would get wrong.
 */
test("a dispatch budget past the wire's ceiling marks its own box", async () => {
  await drawSettings();
  await turned(() => {
    edit("Limits");
  });
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: String(leadDispatchesMax + 1) },
    });
  });
  expect(box("Dispatches").getAttribute("aria-invalid")).toBe("true");
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: String(leadDispatchesMax) },
    });
  });
  expect(
    box("Dispatches").getAttribute("aria-invalid"),
    "the box refused the ceiling itself and not only what is past it",
  ).toBe("false");
});

/**
 * The route replaces the whole override set, so an override no section draws is
 * deleted by any save that does not carry it. Nothing on the page shows an
 * allowlist, so nothing on the page would show it going.
 */
test("an override no section draws survives a save that edits another", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    read: settingsBody(12, {
      northStar: "ship the console",
      modelAllowlist: ["claude-opus-4"],
      toolAllowlist: ["Read", "Grep"],
      operationalContextMaxAgeMs: 30_000,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
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

test("a revision that moved under the write is named and not retried", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: {
        error: {
          code: "SettingsRevisionConflict",
          message: "the selector settings moved under this write",
        },
        settings: settingsBody(14, { northStar: "somebody else's star" }),
      },
      status: 409,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  expect(within(sectionOf("North Star")).getByText("Conflict · 14"));
  expect(
    (server.written() as { readonly expectedRevision: number })
      .expectedRevision,
  ).toBe(12);
});

/**
 * A write that landed is the newest read, and nothing else will tell the page
 * so: the route raises no frame and nothing refetches. A second save that
 * resent the revision the first one moved would be told by this same tab that
 * somebody else wrote — a dead end reachable by saving twice.
 */
test("a second save is made against the revision the first one produced", async () => {
  let revision = 12;
  const server = await drawSettings({
    answering: () => {
      revision += 1;
      return { body: settingsBody(revision, {}), status: 200 };
    },
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  await turned(() => {
    edit("North Star");
  });
  await turned(save);
  await settled();
  expect(
    server
      .writes()
      .map((body) => (body as { expectedRevision: number }).expectedRevision),
  ).toStrictEqual([12, 13]);
});

/**
 * THE CASE `expectedRevision` EXISTS FOR. This reader edits one limit while
 * another administrator changes the North Star under them, so carrying every
 * drawn box forward would put this reader's stale North Star back on the wire
 * under a revision that by then matches — and the route would accept it, the
 * other write gone with nobody having typed a word of it.
 */
test("a conflict does not carry a box this reader never touched", async () => {
  let conflicting = true;
  const server = await drawSettings({
    answering: () => {
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
    read: settingsBody(12, { northStar: "the original star" }),
  });
  await turned(() => {
    edit("Limits");
  });
  await turned(() => {
    fireEvent.change(box("Tokens"), {
      target: { value: "500" },
    });
  });
  await turned(save);
  await settled();
  expect(within(sectionOf("Limits")).getByText("Conflict · 14"));
  expect(box("Tokens").value).toBe("500");
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
 * THE REBASE IS PER BOX AND NOT PER LIMIT SET: a limit typed in *and* a
 * different limit moved under it. `limits` is one override on the wire, so a
 * rebase taking the reader's whole set wherever one box in it was touched reads
 * as harmless and is the lost update the per-box rule exists to refuse.
 */
test("a conflict rebases a limit beside the budget this reader typed", async () => {
  let conflicting = true;
  const server = await drawSettings({
    answering: () => {
      if (conflicting) {
        conflicting = false;
        return {
          body: {
            error: { code: "SettingsRevisionConflict", message: "moved" },
            settings: settingsBody(14, {
              limits: { tokensPerDecision: 900_000, dispatchesPerDecision: 1 },
            }),
          },
          status: 409,
        };
      }
      return { body: settingsBody(15, {}), status: 200 };
    },
    read: settingsBody(12, {
      limits: { tokensPerDecision: 100, dispatchesPerDecision: 1 },
    }),
  });
  await turned(() => {
    edit("Limits");
  });
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: "5" },
    });
  });
  await turned(save);
  await settled();
  expect(
    box("Tokens").value,
    "a ceiling nobody here typed was held over the one that arrived",
  ).toBe("900000");
  expect(box("Dispatches").value).toBe("5");
  await turned(save);
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 14,
    overrides: {
      limits: { tokensPerDecision: 900_000, dispatchesPerDecision: 5 },
    },
  });
});

/** A conflict rebased the draft but the page still holds the read it was seeded
 * from, so the one action it offers is asking the server again. */
test("Reload after a conflict reads the settings again", async () => {
  const server = await drawSettings({
    answering: () => ({
      body: {
        error: { code: "SettingsRevisionConflict", message: "moved" },
        settings: settingsBody(14, { northStar: "somebody else's star" }),
      },
      status: 409,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    fireEvent.change(box("North Star"), {
      target: { value: "ship the lead page" },
    });
  });
  await turned(save);
  await settled();
  const before = server.reads();
  await turned(() => {
    press("Reload");
  });
  await settled();
  expect(server.reads()).toBeGreaterThan(before);
  expect(box("North Star").value).toBe("ship the lead page");
});

/**
 * A read can move under an open section at any moment, including between a Save
 * click and its answer. A reseed there takes back text the reader typed while
 * they were waiting, which is the one window in which they cannot see it go.
 */
test("text typed while a save is in flight survives the answer", async () => {
  await drawSettings({
    answering: () => ({
      body: settingsBody(13, { northStar: "ship the console" }),
      status: 200,
    }),
  });
  await turned(() => {
    edit("North Star");
  });
  await turned(() => {
    save();
    fireEvent.change(box("North Star"), {
      target: { value: "typed while the save was in flight" },
    });
  });
  await settled();
  await turned(() => {
    edit("North Star");
  });
  expect(
    box("North Star").value,
    "the answer to a save took back what was typed while it was in flight",
  ).toBe("typed while the save was in flight");
});

/**
 * The boxes and the wire's own limit roster are one set, read from the schema
 * rather than listed again. A limit the wire admits and the page draws no row
 * for is not merely invisible: the write rebuilds the whole limit set from the
 * rows, so the first edit to anything would drop it.
 */
test("the page draws a row for every limit the wire admits", () => {
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

const history = {
  revisions: [
    revisionBody(15, {
      northStar: "ship the console",
      limits: { tokensPerDecision: 17_523_063 },
    }),
    revisionBody(14, {
      northStar: "ship the console",
      limits: { tokensPerDecision: 12_000_000 },
    }),
    revisionBody(13, { northStar: "ship the console" }),
  ],
};

/** What each revision moved is derived from the override sets the history read
 * already carries, so the page says it without a server change. */
test("a revision row names the fields it moved and expands to the diff", async () => {
  await drawSettings({ history });
  const revisions = sectionOf("Revisions");
  expect(within(revisions).getAllByText("Tokens").length).toBeGreaterThan(0);
  await turned(() => {
    fireEvent.click(
      within(revisions).getAllByRole("button", {
        name: "Diff",
      })[0] as HTMLElement,
    );
  });
  expect(within(sectionOf("Revisions")).getByText("12,000,000")).toBeDefined();
  expect(within(sectionOf("Revisions")).getByText("17,523,063")).toBeDefined();
  styleless();
});

/** Restore is a write of that revision's overrides under the revision the page
 * holds, which is the whole override set like every other write here. */
test("Restore writes that revision's overrides under the current revision", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(16, {}), status: 200 }),
    history,
  });
  const restores = within(sectionOf("Revisions")).getAllByRole("button", {
    name: "Restore",
  });
  await turned(() => {
    fireEvent.click(restores[0] as HTMLElement);
  });
  await settled();
  expect(server.written()).toStrictEqual({
    expectedRevision: 12,
    overrides: {
      northStar: "ship the console",
      limits: { tokensPerDecision: 12_000_000 },
    },
  });
});

/** The newest revision is what stands, so restoring it is an offer to write
 * what is already written. */
test("the newest revision is the one row with no Restore", async () => {
  await drawSettings({ history });
  expect(
    within(sectionOf("Revisions")).getAllByRole("button", { name: "Restore" }),
  ).toHaveLength(2);
});

test("only the latest revisions stand until Show all is pressed", async () => {
  const many = {
    revisions: Array.from({ length: 7 }, (_unused, at) =>
      revisionBody(20 - at, { limits: { tokensPerDecision: 100 + at } }),
    ),
  };
  await drawSettings({ history: many });
  const rows = () =>
    sectionOf("Revisions").querySelectorAll(".selector-revision");
  expect(rows()).toHaveLength(5);
  await turned(() => {
    press("Show all 7");
  });
  expect(rows()).toHaveLength(7);
});

/**
 * A SETTING A READER CANNOT SEE THE END OF IS A SETTING THEY CANNOT CHECK. A
 * passage past what the section will give it is clipped rather than cut, and
 * says how much it is holding back, so the sections under it are still on the
 * screen.
 */
test("a long passage is clipped until Show all, and a short one is not", async () => {
  const long = "a".repeat(selectorTextShownCharsMax + 1);
  await drawSettings({
    read: settingsBody(12, {}, { basePrompt: long }),
  });
  const prompt = sectionOf("Base prompt");
  expect(prompt.querySelector(".selector-clip")).not.toBeNull();
  expect(within(prompt).getByText(String(selectorTextShownCharsMax + 1)));
  expect(
    within(sectionOf("North Star")).queryByRole("button", { name: /Show all/ }),
  ).toBeNull();

  await turned(() => {
    fireEvent.click(
      within(sectionOf("Base prompt")).getByRole("button", {
        name: /Show all/,
      }),
    );
  });
  const shown = sectionOf("Base prompt");
  expect(shown.querySelector(".selector-clip")).toBeNull();
  expect(within(shown).getByRole("button", { name: "Show less" }));
  styleless();
});

/** The served policy refuses `style-src` but `'self'`, so nothing this page
 * draws — an edit, a save and a revision expanded included — may append a
 * runtime style element. */
test("nothing this page draws is a runtime style element", async () => {
  const server = await drawSettings({
    answering: () => ({ body: settingsBody(13, {}), status: 200 }),
    history,
  });
  styleless();
  await turned(() => {
    edit("Limits");
  });
  styleless();
  await turned(() => {
    fireEvent.change(box("Dispatches"), {
      target: { value: "3" },
    });
  });
  save();
  await settled();
  expect(server.writes()).toHaveLength(1);
  styleless();
});
