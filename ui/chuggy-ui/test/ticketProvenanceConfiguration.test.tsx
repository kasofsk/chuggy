/**
 * The Configuration tab over a real, non-empty canonical document: one row
 * per step under a row per phase, each opening onto its details.
 *
 * The canonical body is read from the version 1 `chuggy-development-sonnet.json`
 * this repository declared before its catalogs, so the rows are asserted
 * against a document that was really declared; the Review row, which a
 * declared document with stages never draws, is asserted over the same
 * document with its stages taken out.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConfigurationOverrides } from "../../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../../src/contract/configurationSelection.ts";
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type { TicketFollowing } from "../../../src/contract/responses.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  TicketConfigurationTab,
  TicketOverviewTab,
} from "../app/browser/ticket/TicketPageTabs.tsx";
import { finalizationLine } from "../app/core/codeLabels.ts";
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
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
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
  tab: ReactNode = <TicketConfigurationTab />,
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
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <TicketPage>{tab}</TicketPage>
    </ScreenHarness>,
  );
  await settled();
}

/** The page with every row opened and every prompt shown, which the page
 * draws folded. */
async function drawExpanded(
  ...args: Parameters<typeof drawTicket>
): Promise<void> {
  await drawTicket(...args);
  await turned(() => {
    for (const button of document.querySelectorAll<HTMLElement>(
      ".config-step > .disclosure > button",
    ))
      button.click();
  });
  await turned(() => {
    for (const button of screen.queryAllByRole("button", {
      name: "View prompt",
    }))
      button.click();
  });
  await settled();
}

/** Each phase's group, by its phase. */
function group(phase: "Work" | "Evaluation" | "Finalization"): HTMLElement {
  const found = document.querySelector(
    `.config-steps-group[data-phase="${phase}"]`,
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no ${phase} drawn`);
  return found;
}

function groupsDrawn(): readonly string[] {
  return [...document.querySelectorAll<HTMLElement>(".config-steps-group")].map(
    (drawn) => drawn.dataset["phase"] ?? "",
  );
}

/** What a group's own row says after its phase. */
function groupNote(phase: "Work" | "Evaluation" | "Finalization") {
  return group(phase).querySelector(".config-steps-note")?.textContent;
}

/** The rows a part of the page draws, in order. */
function rowsIn(within: ParentNode = document): readonly HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>(".config-step")];
}

function stepOf(row: HTMLElement): string {
  return row.querySelector(".config-step-name > span")?.textContent ?? "";
}

/** The row of a step, by the name in its Step cell. */
function row(step: string, within?: ParentNode): HTMLElement {
  const found = rowsIn(within).find((held) => stepOf(held) === step);
  if (found === undefined) throw new Error(`no ${step} row`);
  return found;
}

/** One cell of a row, by its column. */
function cell(
  step: HTMLElement,
  column: "workload" | "runs" | "model" | "overrides",
): string | undefined {
  return step.querySelector(`.config-step-${column}`)?.textContent ?? undefined;
}

/** What an opened row's details say, by the name over each. */
function details(step: HTMLElement): ReadonlyMap<string, string> {
  return new Map(
    [...step.querySelectorAll(".config-step-detail")].map(
      (detail) =>
        [
          detail.querySelector("dt")?.textContent ?? "",
          detail.querySelector("dd")?.textContent ?? "",
        ] as const,
    ),
  );
}

const overriddenWords = "overridden on this ticket";

test("the configuration is drawn as one row per step under a row per phase, headed by its name", async () => {
  await drawTicket();
  expect(groupsDrawn()).toStrictEqual(["Work", "Evaluation"]);
  expect(rowsIn(group("Work")).map(stepOf)).toStrictEqual(["Work"]);
  expect(rowsIn(group("Evaluation")).map(stepOf)).toStrictEqual([
    "Stage 1",
    "Stage 2",
  ]);
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "chuggy-development-sonnet #1",
    }),
  ).toBeDefined();
  expect(screen.getByText("Pinned")).toBeDefined();
  expect(screen.getByRole("link", { name: /^Catalog/u })).toBeDefined();
});

test("the sidebar names the member who filed the ticket, the whole subject on hover", async () => {
  const creator = "23:https://issuer.example/alice";
  await drawTicket(
    canonical,
    undefined,
    creator,
    undefined,
    undefined,
    undefined,
    <TicketOverviewTab />,
  );
  const filed = screen.getAllByText("Filed by")[0]?.closest("div");
  expect(filed).not.toBeNull();
  expect(within(filed as HTMLElement).getByText("alice")).toBeDefined();
  expect(screen.queryByText(creator)).toBeNull();
});

test("a ticket the wire names no creator for draws no filed-by field at all", async () => {
  await drawTicket(
    canonical,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    <TicketOverviewTab />,
  );
  expect(screen.getByText("Depends on")).toBeDefined();
  expect(screen.queryByText("Filed by")).toBeNull();
});

test("the Work row reads the model off its own flag, and opens onto its settings", async () => {
  await drawExpanded();
  const work = row("Work");
  expect(cell(work, "runs")).toBe("Claude");
  expect(cell(work, "model")).toBe("Sonnet");
  expect(details(work)).toStrictEqual(
    new Map([
      [
        "Arguments",
        "--allowedTools=Bash,Edit,Read,Write,Glob,Grep --model=sonnet",
      ],
      ["Tools", "Bash · Edit · Read · Write · Glob · Grep"],
      ["Credentials", "chuggy-github-worker · claude-code · track-record"],
      ["Access", "Network · Workspace writable"],
      ["Image", "worker@sha256:0efb9a93"],
      ["Setup", "npm ci"],
      ["Practices", "Regression coverage · Acceptance criteria"],
      ["Completes task", "No"],
    ]),
  );
});

const workText =
  "Implement the requested change and add focused regression coverage.";
const reviewText =
  "Read .chug/tasks/review-change.md and review the change exactly as that brief requires.";

test("the Work prompt is the shared brief and the work's own words, and holds no review", async () => {
  await drawExpanded();
  const work = row("Work");
  expect(
    within(work).getByText(
      /Develop Chuggy itself in the same repository-native/u,
    ),
  ).toBeDefined();
  expect(within(work).getByText(workText)).toBeDefined();
  expect(within(work).queryByText(reviewText)).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
});

test("an open prompt and an open YAML view each control what they opened", async () => {
  await drawExpanded();
  await turned(() => {
    within(row("Work")).getByRole("button", { name: "YAML" }).click();
  });
  for (const name of ["Hide prompt", "YAML"]) {
    const toggle = within(row("Work")).getByRole("button", { name });
    const controlled = toggle.getAttribute("aria-controls");
    expect(controlled).not.toBeNull();
    expect(
      document.getElementById(controlled ?? "")?.getAttribute("data-state"),
    ).toBe("open");
  }
});

test("a configuration with no stages draws its review block as one Review row", async () => {
  const unstaged = Object.fromEntries(
    Object.entries(JSON.parse(canonical) as Record<string, unknown>).filter(
      ([key]) => key !== "evaluations",
    ),
  );
  await drawExpanded(JSON.stringify(unstaged));
  expect(rowsIn(group("Evaluation")).map(stepOf)).toStrictEqual(["Review"]);
  const review = row("Review");
  expect(within(review).getByText(reviewText)).toBeDefined();
  expect(within(review).queryByText(workText)).toBeNull();
  expect(details(review).get("Practices")).toBe(
    "Regression coverage · Acceptance criteria",
  );
});

test("a version 1 configuration's stages read Stage N, each with what runs it", async () => {
  await drawExpanded();
  const check = row("Stage 1");
  expect(cell(check, "runs")).toBe("Commands · .chug/tasks/ci.sh");
  expect(cell(check, "model")).toBe("—");
  expect(details(check).get("Commands")).toBe(".chug/tasks/ci.sh");
  const review = row("Stage 2");
  expect(cell(review, "runs")).toBe("Claude");
  expect(details(review).get("Practices")).toBe(
    "Changed call paths · Acceptance criteria",
  );
  expect(within(review).getByText(/Acceptance criteria/u)).toBeDefined();
  expect(screen.queryByText(/^Stage \d · /u)).toBeNull();
});

/** A command is one token as often as not, and the column it stands in is as
 * narrow as the reader leaves the page. */
test("a detail breaks inside its column rather than widening it", async () => {
  await drawExpanded();
  const value = row("Stage 1").querySelector(".config-step-detail dd");
  if (value === null) throw new Error("no detail drawn");
  const rules = sheetRules(ticketSheet, []);
  expect(sheetDeclared(rules, value, "overflow-wrap")).toBe("anywhere");
  expect(sheetDeclared(rules, value, "min-width")).toBe("0px");
});

test("narrow, the heading's links take their own line, the column names go and a row stacks what runs it under its step", async () => {
  await drawTicket();
  const title = document.querySelector(".config-heading-title");
  const columns = document.querySelector(".config-steps-columns");
  const runs = row("Work").querySelector(".config-step-runs");
  if (title === null || columns === null || runs === null)
    throw new Error("no table drawn");
  const desk = sheetRules(ticketSheet, []);
  const narrow = sheetRules(ticketSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(desk, columns, "display")).toBe("grid");
  expect(sheetDeclared(narrow, columns, "display")).toBe("none");
  expect(sheetDeclared(narrow, runs, "grid-column")).toBe("2 / -1");
  expect(sheetDeclared(desk, title, "flex-basis")).toBe("auto");
  expect(sheetDeclared(narrow, title, "flex-basis")).toBe("100%");
});

test("the foot keeps the digest and the full revision", async () => {
  await drawTicket();
  expect(screen.getByText("Digest").nextElementSibling?.textContent).toBe(
    `${digest.slice(0, 12)}…${digest.slice(-6)}`,
  );
  expect(document.querySelector(".config-foot")?.textContent).toContain(
    revision,
  );
});

test("a ticket with no overrides marks nothing, and its Overrides column is empty", async () => {
  await drawExpanded();
  expect(screen.queryByText(new RegExp(overriddenWords, "u"))).toBeNull();
  expect(rowsIn().map((drawn) => cell(drawn, "overrides"))).toEqual(
    rowsIn().map(() => ""),
  );
  expect(screen.queryByText("Overridden")).toBeNull();
  expect(screen.getByRole("button", { name: "Canonical JSON" })).toBeDefined();
});

test("a model the ticket overrode is drawn as the row's model, named in its column and marked beside its arguments alone", async () => {
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
  const work = row("Work");
  expect(cell(work, "model")).toBe("Opus");
  expect(cell(work, "overrides")).toBe("Model");
  expect(details(work).get("Arguments")).toContain("--model=opus");
  expect(details(work).get("Arguments")).toContain(overriddenWords);
  expect(details(work).get("Setup")).toBe("npm ci");
  expect(screen.getAllByText(new RegExp(overriddenWords, "u"))).toHaveLength(1);
  expect(screen.queryByText("Sonnet")).toBeNull();
});

test("an override is drawn once, beside its value, whatever field it is", async () => {
  await drawExpanded(canonical, {
    worker: { files: [{ path: "notes.md", content: "remember this" }] },
  });
  const work = row("Work");
  expect(cell(work, "overrides")).toBe("Files");
  expect(details(work).get("Files")).toBe(`notes.md · ${overriddenWords}`);
  expect(screen.getAllByText(new RegExp(overriddenWords, "u"))).toHaveLength(1);
});

test("instructions the ticket overrode are its prompt, marked over them", async () => {
  await drawExpanded(canonical, {
    work: { instructions: ["Do it the overridden way."] },
  });
  const work = row("Work");
  expect(cell(work, "overrides")).toBe("Work instructions");
  expect(within(work).getByText("Do it the overridden way.")).toBeDefined();
  expect(within(work).queryByText(workText)).toBeNull();
  expect(
    within(work).getByRole("heading", { name: /^Instructions/u }).textContent,
  ).toBe(`Instructions · ${overriddenWords}`);
});

test("a catalog draws what the ticket selected of it: its work, its plan's stages in order and its landing", async () => {
  await drawExpanded(creationCatalogCanonical, undefined, undefined, {
    evaluation: "gated",
    finalization: "approved",
  });
  expect(groupsDrawn()).toStrictEqual(["Work", "Evaluation", "Finalization"]);
  const work = row("Work");
  expect(cell(work, "workload")).toBe("build");
  expect(cell(work, "runs")).toBe("Claude · prompts/build.md");
  expect(within(work).getByText(/^Build it\./u)).toBeDefined();
  expect(rowsIn(group("Evaluation")).map(stepOf)).toStrictEqual([
    "review",
    "review",
    "review",
    "gates",
  ]);
  const gates = row("gates");
  expect(cell(gates, "workload")).toBeUndefined();
  expect(cell(gates, "runs")).toBe("Commands · npm test");
  expect(details(row("Landing", group("Finalization")))).toStrictEqual(
    new Map([["Approval", "Required"]]),
  );
  expect(screen.queryByText("Do it fast.")).toBeNull();
});

test("a stage of two evaluators is a row with a row per evaluator under it", async () => {
  await drawTicket(creationCatalogCanonical, undefined, undefined, {
    evaluation: "gated",
  });
  const [stage, ...evaluators] = rowsIn(group("Evaluation"));
  if (stage === undefined) throw new Error("no stage drawn");
  expect(cell(stage, "runs")).toBe("2 side by side");
  expect(stage.querySelector("button")).toBeNull();
  expect(stage.dataset["nested"]).toBeUndefined();
  expect(
    evaluators.map((drawn) => [stepOf(drawn), drawn.dataset["nested"]]),
  ).toStrictEqual([
    ["review", "true"],
    ["review", "true"],
    ["gates", undefined],
  ]);
});

test("the selection's default is said once, in its group's row", async () => {
  await drawTicket(creationCatalogCanonical);
  expect(groupNote("Work")).toBe("default");
  expect(groupNote("Evaluation")).toBe("plan review · default");
  expect(groupNote("Finalization")).toBeUndefined();
  expect(screen.getAllByText(/default$/u)).toHaveLength(2);
  cleanup();
  await drawTicket(creationCatalogCanonical, undefined, undefined, {
    work: "quick",
    evaluation: "gated",
  });
  expect(groupNote("Work")).toBeUndefined();
  expect(groupNote("Evaluation")).toBe("plan gated");
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

test("a catalog ticket's heading says the revision it runs on: its own choice, else its catalog's default, else Pinned", async () => {
  const cases = [
    [creationCatalogCanonical, { configuration: "Latest" }, "Latest"],
    [catalogFollowing("Latest"), { configuration: "Pinned" }, "Pinned"],
    [catalogFollowing("Latest"), undefined, "Latest"],
    [creationCatalogCanonical, undefined, "Pinned"],
  ] as const;
  for (const [served, selection, value] of cases) {
    await drawTicket(served, undefined, undefined, selection);
    const heading = document.querySelector(".config-heading");
    if (!(heading instanceof HTMLElement)) throw new Error("no heading");
    expect(within(heading).getByText(value)).toBeDefined();
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
    await drawTicket(
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

test("a catalog ticket is drawn under its workload overrides, each named on its own row", async () => {
  await drawExpanded(
    creationCatalogCanonical,
    {
      workloads: {
        build: { prompt: { text: "Build it twice." }, resources: { cpus: 4 } },
      },
    },
    undefined,
    { evaluation: "gated" },
  );
  const work = row("Work");
  expect(cell(work, "overrides")).toBe("Prompt · 4 CPUs");
  expect(details(work).get("CPUs")).toBe(`4 · ${overriddenWords}`);
  expect(within(work).getByText("Build it twice.")).toBeDefined();
  expect(screen.queryByText("Build it.")).toBeNull();
  expect(cell(row("gates"), "overrides")).toBe("");
});

test("the rows are folded until asked for, and each opens onto a YAML view of its definition", async () => {
  await drawTicket();
  expect(screen.queryByRole("button", { name: "YAML" })).toBeNull();
  const work = row("Work").querySelector("button");
  expect(work?.getAttribute("aria-expanded")).toBe("false");
  await turned(() => {
    work?.click();
  });
  expect(work?.getAttribute("aria-expanded")).toBe("true");
  const toggle = within(row("Work")).getByRole("button", { name: "YAML" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await turned(() => {
    toggle.click();
  });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(
    within(row("Work")).getByText(/allowedTools/u, { selector: "pre" }),
  ).toBeDefined();
});

/** A brief that names how its work is finalized, and nothing else of note. */
const briefFinalized = {
  intent: "ship it",
  links: [],
  branch: "refs/heads/feature",
  finalization: { kind: "PullRequest", target: "refs/heads/release" },
} as const;

/** The landing a brief's finalization is drawn as. */
function landing(): HTMLElement {
  return row("Landing", group("Finalization"));
}

test("a version 1 ticket's landing is the one its brief names, and no Finalization is drawn where it names none", async () => {
  await drawTicket(
    canonical,
    undefined,
    undefined,
    undefined,
    undefined,
    briefFinalized,
  );
  expect(cell(landing(), "runs")).toBe(
    finalizationLine(briefFinalized.finalization),
  );
  cleanup();
  await drawTicket();
  expect(groupsDrawn()).not.toContain("Finalization");
});

test("a catalog ticket's landing is the brief's before its finalizer's, with the finalizer's approval", async () => {
  await drawExpanded(
    creationCatalogCanonical,
    undefined,
    undefined,
    { finalization: "approved" },
    undefined,
    briefFinalized,
  );
  expect(cell(landing(), "runs")).toBe(
    finalizationLine(briefFinalized.finalization),
  );
  expect(details(landing())).toStrictEqual(new Map([["Approval", "Required"]]));
});

/** A policy orders a git merge alone, so it is drawn beside a git merge's
 * landing and beside no other kind's. */
test("a git merge's landing opens onto its policy", async () => {
  const merged = {
    ...briefFinalized,
    finalization: {
      kind: "GitMerge",
      mode: "PullRequestMerge",
      target: "refs/heads/release",
      policy: "Serialized",
    },
  } as const;
  await drawTicket(
    canonical,
    undefined,
    undefined,
    undefined,
    undefined,
    merged,
  );
  await turned(() => {
    landing().querySelector("button")?.click();
  });
  expect(cell(landing(), "runs")).toBe(
    "Pull request, then merge · into refs/heads/release",
  );
  expect(details(landing())).toStrictEqual(new Map([["Policy", "Serialized"]]));
});

test("a catalog with no finalizer for the ticket draws its landing with nothing to run it", async () => {
  const unfinalized = JSON.parse(creationCatalogCanonical) as {
    finalizers?: unknown;
    readonly defaults: { finalization?: unknown };
  };
  delete unfinalized.finalizers;
  delete unfinalized.defaults.finalization;
  await drawTicket(JSON.stringify(unfinalized));
  expect(cell(landing(), "runs")).toBe("—");
  expect(groupNote("Finalization")).toBeUndefined();
  expect(landing().querySelector("button")).toBeNull();
});
