/**
 * The Configuration panel over a real, non-empty canonical document, broken
 * out into the work, the evaluation and the finalization it decides.
 *
 * The canonical body is read from the version 1 `chuggy-development-sonnet.json`
 * this repository declared before its catalogs, so the settings grid, the
 * Instructions and the Evaluation list are asserted against a document that
 * was really declared; the Review
 * tab, which a declared document with stages never draws, is asserted over the
 * same document with its stages taken out.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConfigurationOverrides } from "../../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../../src/contract/configurationSelection.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { TicketFollowing } from "../../../src/contract/responses.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import { briefLandingLine } from "../app/core/codeLabels.ts";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  ticketPageAmbientRoute,
  turned,
} from "./screenHarness.tsx";
import { creationCatalogCanonical } from "./ticketCreationFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** The version 1 fixtures, read at build time by Vite rather than by Node's own `fs`. */
const declarations = import.meta.glob<string>(
  "../../../test/fixtures/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);
const sonnetRaw =
  declarations[
    "../../../test/fixtures/configurations/chuggy-development-sonnet.json"
  ];
if (sonnetRaw === undefined)
  throw new Error("no chuggy-development-sonnet configuration declared");
const declared: unknown = JSON.parse(sonnetRaw);
const canonical = JSON.stringify(
  (declared as { readonly configuration: unknown }).configuration,
);

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ ...atlas, ticket: "9" }),
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revision = "r-sonnet-1";
const version = { name: "chuggy-development-sonnet", number: 1 };
const digest = "d".repeat(64);

async function drawTicket(
  served: string = canonical,
  overrides?: ConfigurationOverrides,
  creator?: string,
  selection?: ConfigurationSelection,
  following?: TicketFollowing,
  brief?: unknown,
): Promise<void> {
  const api = apiDouble({
    operation: { operation: "op-one", state: "Pending" },
    route: (url) => {
      const ambient = ticketPageAmbientRoute(url);
      if (ambient !== undefined) return ambient;
      if (url.includes("/executions")) return answer({ executions: [] });
      if (url.includes("/configurations/"))
        return answer({
          partition: atlas,
          revision,
          canonical: served,
          digest,
          version,
        });
      if (url.includes("/drafts/"))
        return answer({
          partition: atlas,
          ticket: 9,
          authoringVersion: 1,
          state: "Released",
          releasedAuthoringVersion: 1,
          configurationRevision: revision,
          authoring: { dependencies: [], program: [] },
        });
      return answer({
        ticket: 9,
        phase: "Work",
        sequence: 3,
        ...ticketInstants,
        configurationRevision: revision,
        configurationVersion: version,
        ...(overrides === undefined ? {} : { overrides }),
        ...(creator === undefined ? {} : { creator }),
        ...(selection === undefined ? {} : { selection }),
        ...(following === undefined ? {} : { following }),
        ...(brief === undefined ? {} : { brief }),
      });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  render(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
}

/** The page with every task opened and its prompt shown, which the page
 * draws folded. */
async function drawExpanded(
  ...args: Parameters<typeof drawTicket>
): Promise<void> {
  await drawTicket(...args);
  await turned(() => {
    for (const label of document.querySelectorAll(".ticket-config-task-label"))
      label.closest("button")?.click();
  });
  await turned(() => {
    for (const button of screen.queryAllByRole("button", {
      name: "View prompt",
    }))
      button.click();
  });
  await settled();
}

test("the configuration is broken out into Work, Evaluation and Finalization", async () => {
  await drawExpanded();
  const headings = screen
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
  expect(headings).toContain("Work");
  expect(headings).toContain("Evaluation");
  expect(
    screen.queryAllByRole("heading", { name: /^Provenance$/iu }),
  ).toHaveLength(0);
  expect(
    screen.getByRole("heading", {
      name: /Configuration chuggy-development-sonnet/u,
    }),
  ).toBeDefined();
});

test("the status row names the member who filed the ticket, the whole subject on hover", async () => {
  const creator = "23:https://issuer.example/alice";
  await drawExpanded(canonical, undefined, creator);
  const filed = screen.getAllByText("Filed by")[0]?.closest("div");
  expect(filed).not.toBeNull();
  expect(within(filed as HTMLElement).getByText("alice")).toBeDefined();
  expect(screen.queryByText(creator)).toBeNull();
});

test("a ticket the wire names no creator for draws no filed-by field at all", async () => {
  await drawExpanded();
  expect(screen.getByText("Released under")).toBeDefined();
  expect(
    screen
      .getAllByText("Filed by")
      .map((name) => name.nextElementSibling?.textContent),
  ).toEqual(["—", "—"]);
});

test("the settings grid reads the model off its own flag and the tools off the allow-list", async () => {
  await drawExpanded();
  expect(screen.getByText("Sonnet")).toBeDefined();
  expect(screen.getByText("--model=sonnet")).toBeDefined();
  expect(screen.getByText("Claude Code")).toBeDefined();
  expect(screen.getByText("Single agent")).toBeDefined();
  expect(
    screen.getByText("Bash · Edit · Read · Write · Glob · Grep"),
  ).toBeDefined();
  expect(
    screen.getByText("chuggy-github-worker · claude-code · track-record"),
  ).toBeDefined();
  expect(screen.getByText("Network · Workspace writable")).toBeDefined();
  expect(screen.getByText("npm ci")).toBeDefined();
  expect(
    screen.getByText("Completes task").nextElementSibling?.textContent,
  ).toBe("No");
});

const workText =
  "Implement the requested change and add focused regression coverage.";
const reviewText =
  "Read .chug/tasks/review-change.md and review the change exactly as that brief requires.";

/** The Instructions block alone, since the Evaluation section below it can
 * carry the very same sentence as a stage's own instructions. */
function instructions(): HTMLElement {
  const region = document.querySelector(".ticket-config-instructions");
  if (!(region instanceof HTMLElement))
    throw new Error("no instructions block");
  return region;
}

test("the Instructions draw the shared brief and the work's own words, and no Review where stages brief the review", async () => {
  await drawExpanded();
  expect(
    within(instructions()).getByText(
      /Develop Chuggy itself in the same repository-native/u,
    ),
  ).toBeDefined();
  expect(within(instructions()).getByText(workText)).toBeDefined();
  expect(within(instructions()).getByText("Regression coverage")).toBeDefined();
  expect(within(instructions()).queryByRole("tab")).toBeNull();
  expect(within(instructions()).queryByRole("tabpanel")).toBeNull();
  expect(within(instructions()).queryByText(reviewText)).toBeNull();
});

test("a configuration with no stages draws a Review tab, Work first", async () => {
  const unstaged = Object.fromEntries(
    Object.entries(JSON.parse(canonical) as Record<string, unknown>).filter(
      ([key]) => key !== "evaluations",
    ),
  );
  await drawExpanded(JSON.stringify(unstaged));
  expect(within(instructions()).queryByText(reviewText)).toBeNull();
  await turned(() => {
    /** Radix selects a tab on `mousedown`, not `click`, and jsdom's own
     * `.click()` never raises the former. */
    fireEvent.mouseDown(
      within(instructions()).getByRole("tab", { name: "Review" }),
    );
  });
  expect(within(instructions()).getByText(reviewText)).toBeDefined();
  expect(within(instructions()).getByText("Regression coverage")).toBeDefined();
  expect(within(instructions()).queryByText(workText)).toBeNull();
});

/** The part of the configuration drawn for one phase. */
function configurationSection(
  stage: "work" | "evaluation" | "finalization",
): HTMLElement {
  const section = document.querySelector(
    `.ticket-config-sub[data-stage="${stage}"]`,
  );
  if (!(section instanceof HTMLElement)) throw new Error(`no ${stage} drawn`);
  return section;
}

/** Each task the Evaluation section draws, by the title on its folded line. */
function stageTasks(): ReadonlyMap<string, HTMLElement> {
  const section = document.querySelector(
    '.ticket-config-sub[data-stage="evaluation"]',
  );
  return new Map(
    [
      ...(section?.querySelectorAll<HTMLElement>(".ticket-config-task") ?? []),
    ].map(
      (task) =>
        [task.querySelector("strong")?.textContent ?? "", task] as const,
    ),
  );
}

function stageTask(title: string): HTMLElement {
  const task = stageTasks().get(title);
  if (task === undefined) throw new Error(`no ${title} task`);
  return task;
}

test("the evaluation list draws one task per stage, its checks or its instructions and practices", async () => {
  await drawExpanded();
  expect([...stageTasks().keys()]).toStrictEqual(["Stage 1", "Stage 2"]);
  const check = stageTask("Stage 1");
  expect(check.querySelector(".ticket-config-task-line")?.textContent).toBe(
    "Commands · .chug/tasks/ci.sh",
  );
  expect(check.querySelector(".ticket-config-command")?.textContent).toBe(
    ".chug/tasks/ci.sh",
  );
  const review = stageTask("Stage 2");
  expect(review.querySelector(".ticket-config-task-line")?.textContent).toBe(
    "Review",
  );
  expect(within(review).getByText("Changed call paths")).toBeDefined();
  expect(within(review).getByText(/Acceptance criteria/u)).toBeDefined();
});

/** A check is one token as often as not, and the column it stands in is as
 * narrow as the reader leaves the pages. */
test("a stage's check breaks inside the column rather than widening it", async () => {
  await drawExpanded();
  const check = stageTask("Stage 1").querySelector(".ticket-config-command");
  if (check === null) throw new Error("no check drawn");
  const rules = sheetRules(ticketSheet, []);
  expect(sheetDeclared(rules, check, "overflow-wrap")).toBe("anywhere");
  expect(sheetDeclared(rules, check, "min-width")).toBe("0px");
  expect(sheetDeclared(rules, check, "max-width")).toBe("100%");
});

test("a version 1 configuration's evaluation draws no hint about stage order", async () => {
  await drawExpanded();
  expect(screen.queryByText(/Stages run in order/u)).toBeNull();
  expect(screen.queryByText("Evaluators run side by side")).toBeNull();
});

test("the panel keeps the digest and the full revision on a caption line", async () => {
  await drawExpanded();
  expect(screen.getByText("revision").nextElementSibling?.textContent).toBe(
    revision,
  );
  expect(screen.getByText("Digest").nextElementSibling?.textContent).toBe(
    `${digest.slice(0, 12)}…${digest.slice(-6)}`,
  );
});

const caption = "As configured · Exact prompt in the run's conversation";

test("a ticket with no overrides is drawn as its pinned configuration, marking nothing", async () => {
  await drawExpanded();
  expect(within(instructions()).getByText(caption)).toBeDefined();
  expect(screen.queryByText("Overridden")).toBeNull();
  expect(screen.queryByText("Also overridden")).toBeNull();
  expect(screen.queryByText("Pinned ·")).toBeNull();
  expect(screen.getByRole("button", { name: "Canonical JSON" })).toBeDefined();
});

/** The cell a field is drawn in, by the name over it. */
function cell(name: string): HTMLElement {
  const found = screen
    .getAllByText(name)
    .map((one) => one.closest(".ticket-config-cell"))
    .find((one) => one instanceof HTMLElement);
  if (!(found instanceof HTMLElement)) throw new Error(`no ${name} cell`);
  return found;
}

test("a model the ticket overrode is drawn in the model's place, marked overridden", async () => {
  const sonnetMode = (
    JSON.parse(canonical) as {
      readonly worker: { readonly mode: { readonly arguments: string[] } };
    }
  ).worker.mode;
  await drawExpanded(canonical, {
    worker: {
      mode: {
        type: "SingleAgent",
        agent: "Claude",
        arguments: sonnetMode.arguments.map((argument) =>
          argument === "--model=sonnet" ? "--model=opus" : argument,
        ),
      },
    },
  });
  expect(within(cell("Model")).getByText("Opus")).toBeDefined();
  expect(within(cell("Model")).getByText("--model=opus")).toBeDefined();
  expect(within(cell("Model")).getByText("Overridden")).toBeDefined();
  expect(screen.queryByText("Sonnet")).toBeNull();
  expect(within(cell("Setup")).queryByText("Overridden")).toBeNull();
  expect(screen.getByText("Pinned ·")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Pinned canonical JSON" }),
  ).toBeDefined();
  expect(screen.getByText("revision").nextElementSibling?.textContent).toBe(
    revision,
  );
});

test("an override the panel has no place for is listed under it by name, with its value", async () => {
  await drawExpanded(canonical, {
    worker: { files: [{ path: "notes.md", content: "remember this" }] },
  });
  expect(screen.getByText("Also overridden")).toBeDefined();
  const listed = screen.getByText("worker.files").closest("div");
  expect(listed?.textContent).toContain("remember this");
  expect(listed?.textContent).toContain("notes.md");
});

test("instructions the ticket overrode are drawn as the override, and the caption no longer says as configured", async () => {
  await drawExpanded(canonical, {
    work: { instructions: ["Do it the overridden way."] },
  });
  expect(
    within(instructions()).getByText("Do it the overridden way."),
  ).toBeDefined();
  expect(within(instructions()).queryByText(workText)).toBeNull();
  expect(within(instructions()).queryByText(caption)).toBeNull();
  expect(
    within(instructions()).getByText(
      "With overrides · Exact prompt in the run's conversation",
    ),
  ).toBeDefined();
  const heading = within(instructions()).getByRole("heading", {
    name: /^Instructions/u,
  });
  expect(within(heading).getByText("Overridden")).toBeDefined();
});

test("a catalog draws what the ticket selected of it: its work's prompt, its plan's stages and its finalizer", async () => {
  await drawExpanded(creationCatalogCanonical, undefined, undefined, {
    evaluation: "gated",
    finalization: "approved",
  });
  expect(within(cell("Work")).getByText("build")).toBeDefined();
  expect(within(cell("Evaluation")).getByText("gated")).toBeDefined();
  const work = configurationSection("work");
  expect(work.querySelector(".ticket-config-task strong")?.textContent).toBe(
    "build",
  );
  expect(within(work).getAllByText("prompts/build.md").length).toBeGreaterThan(
    0,
  );
  expect(within(work).getByText(/^Build it\./u)).toBeDefined();
  expect(
    within(stageTask("Stage 2 · gates")).getAllByText("npm test").length,
  ).toBeGreaterThan(0);
  const finalization = configurationSection("finalization");
  expect(
    within(finalization).getByText("Finalizer").nextElementSibling?.textContent,
  ).toBe("approved");
  expect(within(finalization).getByText(/Approved first/u)).toBeDefined();
  expect(screen.queryByText("Do it fast.")).toBeNull();
});

/** The fixture catalog with its defaults naming the revision its tickets follow. */
function catalogFollowing(configuration: string): string {
  const parsed = JSON.parse(creationCatalogCanonical) as {
    readonly defaults: object;
  };
  return JSON.stringify({
    ...parsed,
    defaults: { ...parsed.defaults, configuration },
  });
}

test("a catalog ticket draws the revision it runs on: its own choice, else its catalog's default, else Pinned", async () => {
  const cases = [
    [
      creationCatalogCanonical,
      { configuration: "Latest" },
      "Latest",
      "Selected",
    ],
    [
      catalogFollowing("Latest"),
      { configuration: "Pinned" },
      "Pinned",
      "Selected",
    ],
    [catalogFollowing("Latest"), undefined, "Latest", "Default"],
    [creationCatalogCanonical, undefined, "Pinned", "Default"],
  ] as const;
  for (const [served, selection, value, meta] of cases) {
    await drawExpanded(served, undefined, undefined, selection);
    const cell = screen.getByText("Version").closest(".ticket-config-cell");
    if (!(cell instanceof HTMLElement)) throw new Error("no Version cell");
    expect(within(cell).getByText(value)).toBeDefined();
    expect(within(cell).getByText(meta)).toBeDefined();
    cleanup();
  }
});

test("a following ticket held on its revision, or trimmed, says why in one line, and one that is current or would move says nothing", async () => {
  const cases = [
    [
      { verdict: "Held", code: "SelectionUnknown" },
      "Stays on this revision · Workload, plan or finalizer not in the catalog",
    ],
    [
      { verdict: "Held", code: "ConfigurationInvalid" },
      "Stays on this revision · Configuration or overrides cannot run",
    ],
    [
      { verdict: "Trimmed" },
      "Stays on this revision · Program skips part of its plan",
    ],
    [{ verdict: "Current" }, undefined],
    [{ verdict: "Moves" }, undefined],
    [undefined, undefined],
  ] as const;
  for (const [following, line] of cases) {
    await drawExpanded(
      catalogFollowing("Latest"),
      undefined,
      undefined,
      undefined,
      following,
    );
    const drawn = document.querySelectorAll(".ticket-config-following");
    expect([...drawn].map((element) => element.textContent)).toEqual(
      line === undefined ? [] : [line],
    );
    cleanup();
  }
});

/** A catalog stage of several evaluators is drawn as a list of them, so the row says they do not run one after another. */
test("a catalog plan draws its stages in order, and says a stage's several evaluators run side by side", async () => {
  await drawExpanded(creationCatalogCanonical, undefined, undefined, {
    evaluation: "gated",
    finalization: "approved",
  });
  expect(screen.queryByText(/Stages run in order/u)).toBeNull();
  expect([...stageTasks().keys()]).toStrictEqual([
    "Stage 1 · review",
    "Stage 2 · gates",
  ]);
  expect(
    within(stageTask("Stage 1 · review")).getByText(
      "Evaluators run side by side",
    ),
  ).toBeDefined();
  expect(
    within(stageTask("Stage 2 · gates")).queryByText(
      "Evaluators run side by side",
    ),
  ).toBeNull();
});

test("a catalog ticket is drawn under its workload overrides, the workload and its fields marked", async () => {
  await drawExpanded(
    creationCatalogCanonical,
    { workloads: { build: { prompt: { text: "Build it twice." } } } },
    undefined,
    undefined,
  );
  expect(screen.getByText("Build it twice.")).toBeDefined();
  expect(screen.queryByText("Build it.")).toBeNull();
  expect(screen.getAllByText("Overridden").length).toBeGreaterThan(0);
  expect(screen.getByText("prompt")).toBeDefined();
  expect(screen.getByText("Pinned ·")).toBeDefined();
});

test("the tasks are folded until asked for, and each opens onto a YAML view of its definition", async () => {
  await drawTicket();
  expect(screen.queryByRole("button", { name: "YAML" })).toBeNull();
  await turned(() => {
    document
      .querySelector(".ticket-config-task-label")
      ?.closest("button")
      ?.click();
  });
  const toggles = screen.getAllByRole("button", { name: "YAML" });
  expect(toggles.length).toBeGreaterThan(0);
  expect(toggles[0]?.getAttribute("aria-expanded")).toBe("false");
  await turned(() => {
    toggles[0]?.click();
  });
  expect(toggles[0]?.getAttribute("aria-expanded")).toBe("true");
});

/** A brief that names how its work lands, and nothing else of note. */
const briefLanding = {
  intent: "ship it",
  links: [],
  branch: "refs/heads/feature",
  finalization: { kind: "PullRequest", target: "refs/heads/release" },
} as const;

/** The method that brief's finalization is drawn as. */
const briefLandingMethod = briefLandingLine({
  mode: "PullRequest",
  target: "refs/heads/release",
});

/** The cells Finalization draws, by the name over each. */
function finalizationCells(): ReadonlyMap<string, string> {
  return new Map(
    [
      ...configurationSection("finalization").querySelectorAll(
        ".ticket-config-cell",
      ),
    ].map(
      (cell) =>
        [
          cell.querySelector(".eyebrow")?.textContent ?? "",
          cell.querySelector(".ticket-config-value")?.textContent ?? "",
        ] as const,
    ),
  );
}

test("a version 1 ticket's Finalization is the method its brief names, and is not drawn where the brief names none", async () => {
  await drawTicket(
    canonical,
    undefined,
    undefined,
    undefined,
    undefined,
    briefLanding,
  );
  expect(finalizationCells()).toStrictEqual(
    new Map([["Method", briefLandingMethod]]),
  );
  cleanup();
  await drawTicket();
  expect(
    document.querySelector('.ticket-config-sub[data-stage="finalization"]'),
  ).toBeNull();
});

test("a catalog ticket's Finalization is the brief's method before its finalizer's, beside the finalizer it lands through", async () => {
  await drawTicket(
    creationCatalogCanonical,
    undefined,
    undefined,
    { finalization: "approved" },
    undefined,
    briefLanding,
  );
  expect(finalizationCells()).toStrictEqual(
    new Map([
      ["Method", briefLandingMethod],
      ["Finalizer", "approved"],
    ]),
  );
});

test("a catalog with no finalizer for the ticket draws no Finalizer, and says no method was named", async () => {
  const unfinalized = JSON.parse(creationCatalogCanonical) as {
    finalizers?: unknown;
    readonly defaults: { finalization?: unknown };
  };
  delete unfinalized.finalizers;
  delete unfinalized.defaults.finalization;
  await drawTicket(JSON.stringify(unfinalized));
  expect(finalizationCells()).toStrictEqual(new Map([["Method", "—"]]));
});
