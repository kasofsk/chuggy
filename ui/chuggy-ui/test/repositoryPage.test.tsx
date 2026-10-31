/**
 * One repository's page: the landing it defaults to, whether its jobs may
 * change its workflow files, what it declares under `.chug/configurations`,
 * and when that was last imported.
 *
 * THE CONFLICT IS THE CASE WITH TEETH. Two administrators editing one binding
 * must not clobber each other, so what is asserted about a `409` is the second
 * write's `expected` — the reader is left fenced against what now stands, not
 * against what this page read before somebody else wrote.
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

import { RepositoryPage } from "../app/browser/repositories/RepositoryPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
} from "./projectAbilitiesFixture.ts";
import { styleless } from "./styleless.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => Date.parse("2026-10-17T12:00:00Z"),
}));

const chuggy = "https://forge.test/kasofsk/chuggy";

const routed = vi.hoisted(() => ({ repository: "" }));

vi.mock("@tanstack/react-router", () => ({
  createLink:
    (Component: (props: Record<string, unknown>) => ReactNode) =>
    (props: Record<string, unknown>) => {
      const { to, params, ...rest } = props;
      void params;
      return <Component {...rest} href={String(to)} />;
    },
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition, repository: routed.repository }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function binding(
  mode: string,
  repository = chuggy,
  pipelinesWritable = false,
): unknown {
  return {
    repository,
    boundAt: "2026-09-11T00:00:00Z",
    landing: { mode },
    pipelinesWritable,
    configured: true,
  };
}

const initialization = {
  configuration: {
    partition: leadPartition,
    revision: "r6",
    canonical: "{}",
    digest: "a".repeat(64),
  },
  fence: { projectSequence: 41, configurationDigest: "a".repeat(64) },
  defaults: {
    dependencies: [],
    program: [{ key: 1, evaluators: [{ key: 1 }] }],
  },
  choices: {
    programStagesMax: 2,
    evaluatorsMax: 3,
  },
  dependencyCandidates: [],
  dependencyCandidatesTruncated: false,
};

function declared(
  revision: string,
  name: string,
  readiness: "Ready" | "Incomplete",
  repository = chuggy,
): unknown {
  const base = {
    revision,
    digest: "a".repeat(64),
    createdAt: "2026-08-26T00:00:00Z",
    provenance: {
      source: "Repository",
      repository,
      commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
      path: `configurations/${name}.json`,
      name,
    },
    version: { name, number: 12 },
  };
  return readiness === "Incomplete"
    ? { ...base, readiness }
    : {
        ...base,
        readiness,
        image: "forge.test/chuggy/worker:1",
        practices: [],
        workInstructionsCount: 1,
        reviewInstructionsCount: 1,
        finalization: { approvalRequired: true },
        evaluationStagesCount: 2,
      };
}

const configurations = {
  configurations: [
    declared("r6", "chuggy", "Ready"),
    declared("r5", "nightly", "Incomplete"),
    declared("r4", "elsewhere", "Ready", "https://forge.test/gdoteof/scratch"),
  ],
};

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Init {
  readonly method?: string;
  readonly body?: string;
}

interface Drawing {
  /** Which repository the address names, the default being the bound one. */
  readonly repository?: string;
  /** The bindings the project answers with. */
  readonly bound?: readonly unknown[];
  /** What the landing write answers with, in turn, each in the route's own
   * envelope: the row the write left, or the row it lost to. */
  readonly written?: readonly Response[];
  /** Whether every configurations page holds a cursor, so the walk hits the
   * budget rather than the listing's end. The revisions are the first page's
   * alone, a listing holding each one once. */
  readonly truncated?: boolean;
  /** The revisions the project answers with, the default being the fixture. */
  readonly declares?: readonly unknown[];
  /** A `fetch` laid over the page's own, where a case answers one more read. */
  readonly over?: (served: typeof fetch) => typeof fetch;
  /** What each import answers with, in turn, the default being an import. */
  readonly imported?: readonly Promise<Response>[];
  /** The bindings the project answers with once an import was sent. */
  readonly boundAfter?: readonly unknown[];
  /** What the first listing read after an import was sent answers with, where a case holds it back. */
  readonly relisted?: Promise<Response>;
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  routed.repository = drawing.repository ?? chuggy;
  const bound = drawing.bound ?? [binding("Push")];
  const written = [...(drawing.written ?? [])];
  const imported = [...(drawing.imported ?? [])];
  let relisted = drawing.relisted;
  const sent: Sent[] = [];
  const fetching = ((url: string, init?: Init) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (init?.method === "POST")
      return imported.shift() ?? Promise.resolve(answer({ imported: true }));
    if (init?.method === "PUT")
      return Promise.resolve(
        written.shift() ?? answer({ repository: binding("Push") }),
      );
    if (url.includes("/draft-initializations/"))
      return Promise.resolve(answer(initialization));
    if (url.includes("/configurations"))
      return Promise.resolve(
        answer({
          configurations: url.includes("cursor=")
            ? []
            : (drawing.declares ?? configurations.configurations),
          ...(drawing.truncated === true ? { nextCursor: "more" } : {}),
        }),
      );
    const posted = sent.some((one) => one.method === "POST");
    const held = posted ? relisted : undefined;
    if (held !== undefined) {
      relisted = undefined;
      return held;
    }
    return Promise.resolve(
      answer({
        repositories: posted ? (drawing.boundAfter ?? bound) : bound,
      }),
    );
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", (drawing.over ?? ((served) => served))(fetching));
  render(
    <ScreenHarness
      partition={leadPartition}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={openedStream().ports.fetch}
    >
      <RepositoryPage />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

/** The choice in force, which is the radio the group draws as checked. */
function chosenLanding(): string | undefined {
  return ["Push", "Pull request"].find(
    (name) =>
      screen.getByRole("radio", { name }).getAttribute("aria-checked") ===
      "true",
  );
}

async function press(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await settled();
}

/** Opens one section, every section drawing an Edit of its own. */
async function edit(title: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(sectionOf(title)).getByRole("button", { name: "Edit" }),
    );
  });
  await settled();
}

/** Whether the workflow files section draws them allowed. */
function chosenWorkflowFiles(): string | undefined {
  return ["Off", "On"].find(
    (name) =>
      within(sectionOf("Workflow files"))
        .getByRole("radio", { name })
        .getAttribute("aria-checked") === "true",
  );
}

test("the page reads its own binding, and says what it lands as", async () => {
  await drawPage({ bound: [binding("PullRequest")] });
  const landing = sectionOf("Landing");
  expect(
    within(landing).getByText(
      "How a finished ticket lands. A ticket may choose otherwise.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "kasofsk/chuggy" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Repositories" }).getAttribute("href"),
  ).toBe("/$tenant/$project/repositories");
  expect(chosenLanding()).toBe("Pull request");
  expect(
    within(landing)
      .getByRole<HTMLInputElement>("radio", { name: "Push" })
      .getAttribute("data-disabled"),
  ).not.toBe(null);
  styleless();
});

/** A repository the project does not bind has no landing to draw and no
 * configurations of its own to list, so the page says only that. */
test("a repository this project does not bind draws nothing but Not bound", async () => {
  await drawPage({ repository: "https://forge.test/kasofsk/none" });
  expect(screen.getByText("Not bound")).toBeTruthy();
  expect(screen.queryByRole("region", { name: /^Landing/u })).toBeNull();
  expect(screen.queryByRole("region", { name: /^Configurations/u })).toBeNull();
});

/** A retired binding's page, reached by its address, says beside its name
 * that it is unbound; a live one's says nothing. */
test.each([
  ["a retired", "2026-09-14T00:00:00Z", "Repositories/kasofsk/chuggyUnbound"],
  ["a live", undefined, "Repositories/kasofsk/chuggy"],
])(
  "%s binding's top bar says beside its name whether it is unbound",
  async (_which, retiredAt, drawn) => {
    await drawPage({
      bound: [
        {
          repository: chuggy,
          boundAt: "2026-09-11T00:00:00Z",
          landing: { mode: "Push" },
          pipelinesWritable: false,
          configured: true,
          ...(retiredAt === undefined ? {} : { retiredAt }),
        },
      ],
    });
    expect(
      screen.getByRole("heading", { name: "kasofsk/chuggy" }).parentElement
        ?.textContent,
    ).toBe(drawn);
  },
);

test("a saved landing is written against the mode the page read", async () => {
  const sent = await drawPage({
    written: [answer({ repository: binding("PullRequest") })],
  });
  await edit("Landing");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  const wrote = sent.find((one) => one.method === "PUT");
  expect(wrote?.url.endsWith("/repositories/landing")).toBe(true);
  expect(wrote?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
    pipelinesWritable: { expected: false, wanted: false },
  });
  expect(screen.getByText("Written")).toBeTruthy();
  expect(chosenLanding()).toBe("Pull request");
  expect(
    within(sectionOf("Landing")).getByRole("button", { name: "Edit" }),
  ).toBeTruthy();
});

/**
 * The conflict answers the row as it now stands, and the reader chose the same
 * mode it moved to — so the draft takes it, the section says so, and the reload
 * is the one action offered.
 */
test("a landing that moved under the write says so, and rebases onto what stands", async () => {
  const sent = await drawPage({
    written: [
      answer(
        {
          error: {
            code: "RepositoryLandingMoved",
            message: "the landing moved under this write",
          },
          repository: binding("PullRequest"),
        },
        409,
      ),
      answer({ repository: binding("Push") }),
    ],
  });
  await edit("Landing");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  expect(screen.getByText("Settings moved")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Push" }));
  });
  await press("Save changes");
  const writes = sent.filter((one) => one.method === "PUT");
  expect(writes.length).toBe(2);
  expect(writes[1]?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "PullRequest" },
    landing: { mode: "Push" },
    pipelinesWritable: { expected: false, wanted: false },
  });
});

test("the workflow files section says they are off until a binding allows them", async () => {
  await drawPage();
  const section = sectionOf("Workflow files");
  expect(
    within(section).getByText(
      "Lets jobs change GitHub workflow files. The App needs Workflows too.",
    ),
  ).toBeTruthy();
  expect(chosenWorkflowFiles()).toBe("Off");
  expect(
    within(section)
      .getByRole("radio", { name: "On" })
      .getAttribute("data-disabled"),
  ).not.toBe(null);
  cleanup();
  await drawPage({ bound: [binding("Push", chuggy, true)] });
  expect(chosenWorkflowFiles()).toBe("On");
});

/** The section moves its own setting and writes the landing as the page read
 * it, so the landing it did not touch is fenced rather than written over. */
test("allowing workflow files writes them against what the page read, the landing unchanged", async () => {
  const sent = await drawPage({
    bound: [binding("PullRequest")],
    written: [answer({ repository: binding("PullRequest", chuggy, true) })],
  });
  await edit("Workflow files");
  await turned(() => {
    fireEvent.click(
      within(sectionOf("Workflow files")).getByRole("radio", { name: "On" }),
    );
  });
  await press("Save changes");
  const wrote = sent.find((one) => one.method === "PUT");
  expect(wrote?.url.endsWith("/repositories/landing")).toBe(true);
  expect(wrote?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "PullRequest" },
    landing: { mode: "PullRequest" },
    pipelinesWritable: { expected: false, wanted: true },
  });
  expect(within(sectionOf("Workflow files")).getByText("Written")).toBeTruthy();
  expect(chosenWorkflowFiles()).toBe("On");
  expect(chosenLanding()).toBe("Pull request");
});

/** A landing written by the other section moves under this one; the retry is
 * fenced against the landing that now stands, the choice standing. */
test("workflow files the binding moved under say so, and the retry fences on what stands", async () => {
  const sent = await drawPage({
    written: [
      answer(
        {
          error: {
            code: "RepositoryLandingMoved",
            message: "the settings moved under this write",
          },
          repository: binding("None"),
        },
        409,
      ),
      answer({ repository: binding("None", chuggy, true) }),
    ],
  });
  await edit("Workflow files");
  await turned(() => {
    fireEvent.click(
      within(sectionOf("Workflow files")).getByRole("radio", { name: "On" }),
    );
  });
  await press("Save changes");
  expect(
    within(sectionOf("Workflow files")).getByText("Settings moved"),
  ).toBeTruthy();
  expect(chosenWorkflowFiles()).toBe("On");
  await press("Save changes");
  const writes = sent.filter((one) => one.method === "PUT");
  expect(writes.length).toBe(2);
  expect(writes[1]?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "None" },
    landing: { mode: "None" },
    pipelinesWritable: { expected: false, wanted: true },
  });
});

/** One section's write moves the binding the other section's draft was read
 * from, so the other's next write fences against the setting it now holds
 * rather than writing back the one the page first read. */
test("a landing saved after workflow files were allowed keeps them allowed", async () => {
  const sent = await drawPage({
    written: [
      answer({ repository: binding("Push", chuggy, true) }),
      answer({ repository: binding("PullRequest", chuggy, true) }),
    ],
  });
  await edit("Workflow files");
  await turned(() => {
    fireEvent.click(
      within(sectionOf("Workflow files")).getByRole("radio", { name: "On" }),
    );
  });
  await press("Save changes");
  await edit("Landing");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  const writes = sent.filter((one) => one.method === "PUT");
  expect(writes.length).toBe(2);
  expect(writes[1]?.body).toStrictEqual({
    repository: chuggy,
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
    pipelinesWritable: { expected: true, wanted: true },
  });
  expect(chosenWorkflowFiles()).toBe("On");
});

test("cancelling workflow files leaves the setting the page read", async () => {
  await drawPage();
  await edit("Workflow files");
  await turned(() => {
    fireEvent.click(
      within(sectionOf("Workflow files")).getByRole("radio", { name: "On" }),
    );
  });
  await press("Cancel");
  expect(chosenWorkflowFiles()).toBe("Off");
});

test("a refused write says so and leaves the edit open", async () => {
  await drawPage({
    written: [
      answer({ error: { code: "RepositoryLocked", message: "no" } }, 403),
    ],
  });
  await edit("Landing");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Save changes");
  expect(
    screen.getByText("Failed · the API rejected this read as RepositoryLocked"),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
});

test("cancelling a choice leaves the landing the page read", async () => {
  await drawPage();
  await edit("Landing");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Pull request" }));
  });
  await press("Cancel");
  expect(chosenLanding()).toBe("Push");
});

/**
 * The listing is the project's, so a revision another repository declares must
 * not appear here — the row it would draw reads as this repository's.
 */
test("the configurations are this repository's own, incomplete rows saying so", async () => {
  await drawPage();
  const rows = within(sectionOf("Configurations")).getAllByRole("row");
  expect(
    rows.map((row) => [...row.children].map((cell) => cell.textContent)),
  ).toStrictEqual([
    ["Configuration", "Worker", "Stages", "Approval"],
    ["chuggy #12", "worker:1", "2", "Required"],
    ["nightly #12", "Incomplete"],
  ]);
});

/**
 * The rows a budget stopped short of are indistinguishable from rows that do
 * not exist, so a walk that stopped says so instead of the page reading as a
 * repository that declares nothing.
 */
test("a walk the budget stopped says so, in place of the empty state", async () => {
  await drawPage({ truncated: true, declares: [] });
  const section = sectionOf("Configurations");
  expect(
    within(section).getByText("Not every configuration was read"),
  ).toBeTruthy();
  expect(within(section).queryByText("No configuration declared")).toBeNull();
  expect(within(section).queryByRole("table")).toBeNull();
});

test("a walk the budget stopped says so under the rows it did read", async () => {
  await drawPage({ truncated: true });
  const section = sectionOf("Configurations");
  expect(within(section).getAllByRole("row").length).toBe(3);
  expect(
    within(section).getByText("Not every configuration was read"),
  ).toBeTruthy();
  styleless();
});

function landingEditOffered(title = "Landing"): boolean {
  return (
    within(sectionOf(title)).queryByRole("button", { name: "Edit" }) !== null
  );
}

test("a reader who may not administer reads the landing and is offered no Edit", async () => {
  await drawPage({
    over: abilitiesOver({ ...abilitiesEvery, administer: false }),
  });
  expect(chosenLanding()).toBe("Push");
  expect(landingEditOffered()).toBe(false);
});

test("a reader who may not administer reads the workflow files and is offered no Edit", async () => {
  await drawPage({
    bound: [binding("Push", chuggy, true)],
    over: abilitiesOver({ ...abilitiesEvery, administer: false }),
  });
  expect(chosenWorkflowFiles()).toBe("On");
  expect(landingEditOffered("Workflow files")).toBe(false);
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered the landing's Edit",
  async (_said, abilities) => {
    await drawPage({ over: abilitiesOver(abilities) });
    expect(landingEditOffered()).toBe(true);
    expect(landingEditOffered("Workflow files")).toBe(true);
  },
);

/** The bound repository as the listing answers it, carrying the last import where one is given. */
function attempted(lastImport?: unknown): unknown {
  return {
    ...(binding("Push") as object),
    ...(lastImport === undefined ? {} : { lastImport }),
  };
}

const attemptCommit = "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23";

/** The line the Configurations card opens with, as a reader reads it. */
function importLine(): string | null {
  return (
    within(sectionOf("Configurations")).getByText("Last import").parentElement
      ?.textContent ?? null
  );
}

function importOffered(): HTMLElement | null {
  return within(sectionOf("Configurations")).queryByRole("button", {
    name: /^Import/u,
  });
}

/** A repository no import was attempted of says so, and is offered one. */
test.each([
  ["never attempted", undefined, "Last importNever"],
  [
    "imported",
    {
      attemptedAt: "2026-10-17T09:30:00.000000Z",
      commit: attemptCommit,
      outcome: { result: "Imported" },
    },
    "Last importImported2h agocfaca0a",
  ],
  [
    "refused",
    {
      attemptedAt: "2026-10-17T11:59:30.000000Z",
      commit: attemptCommit,
      outcome: { result: "DeclarationsRefused" },
    },
    "Last importInvalid30s agocfaca0a",
  ],
  [
    "empty",
    {
      attemptedAt: "2026-10-16T12:00:00.000000Z",
      outcome: { result: "SnapshotAbsent", absent: "Commit" },
    },
    "Last importEmpty1d ago",
  ],
])(
  "a repository %s says so on the last import line",
  async (_which, lastImport, line) => {
    await drawPage({ bound: [attempted(lastImport)] });
    expect(importLine()).toBe(line);
    expect(importOffered()?.textContent).toBe("Import now");
  },
);

test("a refused import names the file it was refused for and its fault under the line", async () => {
  await drawPage({
    bound: [
      attempted({
        attemptedAt: "2026-10-17T11:59:30.000000Z",
        commit: attemptCommit,
        outcome: {
          result: "DeclarationsRefused",
          refusals: [
            {
              path: ".chug/configurations/basic-coding.json",
              fault: "ConfigurationTooLong",
              chars: 70_412,
              charsMax: 65_536,
            },
          ],
          refusalCount: 3,
        },
      }),
    ],
  });
  expect(importLine()).toBe("Last importInvalid30s agocfaca0a");
  expect(
    within(sectionOf("Configurations")).getByText(
      ".chug/configurations/basic-coding.json · 70,412 of 65,536 characters · 2 more",
    ),
  ).toBeDefined();
});

/**
 * The import names the repository and no commit, so the server imports the
 * head it reads; the button is working until the listing it redraws from has
 * been read again.
 */
test("Import now asks for the repository's head, works until the line is redrawn, and draws what it kept", async () => {
  let answerImport: (answered: Response) => void = () => undefined;
  const sent = await drawPage({
    bound: [attempted()],
    imported: [
      new Promise<Response>((resolve) => {
        answerImport = resolve;
      }),
    ],
    boundAfter: [
      attempted({
        attemptedAt: "2026-10-17T11:59:58.000000Z",
        commit: attemptCommit,
        outcome: { result: "Imported" },
      }),
    ],
  });
  await press("Import now");
  const working = importOffered();
  expect(working?.textContent).toBe("Importing…");
  expect(working?.getAttribute("aria-busy")).toBe("true");
  expect(working?.hasAttribute("disabled")).toBe(true);
  expect(importLine()).toBe("Last importNever");
  await turned(() => {
    answerImport(answer({ imported: true }));
  });
  await settled();
  const wrote = sent.filter((one) => one.method === "POST");
  expect(
    wrote.map((one) => [one.url.endsWith("/configurations/imports"), one.body]),
  ).toStrictEqual([[true, { repository: chuggy }]]);
  expect(importLine()).toBe("Last importImported2s agocfaca0a");
  expect(importOffered()?.textContent).toBe("Import now");
  expect(within(sectionOf("Configurations")).queryByRole("status")).toBeNull();
});

/** A refused import is kept like any other, so the line says what it came to and the refusal is said under it. */
test("a refused Import now says why under the line, which draws the attempt it kept", async () => {
  await drawPage({
    bound: [attempted()],
    imported: [
      Promise.resolve(
        answer(
          {
            error: {
              code: "RepositoryConfigurationsRefused",
              message: "The repository configurations were refused.",
            },
            faults: [],
          },
          422,
        ),
      ),
    ],
    boundAfter: [
      attempted({
        attemptedAt: "2026-10-17T11:59:58.000000Z",
        commit: attemptCommit,
        outcome: { result: "DeclarationsRefused" },
      }),
    ],
  });
  await press("Import now");
  expect(importLine()).toBe("Last importInvalid2s agocfaca0a");
  expect(
    within(sectionOf("Configurations")).getByRole("status").textContent,
  ).toBe("Not imported · Invalid");
  expect(importOffered()?.textContent).toBe("Import now");
});

test("a reader who may not mutate the project reads the line and is offered no Import now", async () => {
  await drawPage({
    bound: [attempted()],
    over: abilitiesOver({ ...abilitiesEvery, mutate: false }),
  });
  expect(importLine()).toBe("Last importNever");
  expect(importOffered()).toBeNull();
});

test("a retired binding reads its line and is offered no Import now", async () => {
  await drawPage({
    bound: [{ ...(attempted() as object), retiredAt: "2026-09-14T00:00:00Z" }],
  });
  expect(importLine()).toBe("Last importNever");
  expect(importOffered()).toBeNull();
});

/** An attempt kept by the import a case presses for, two seconds before the page's clock. */
function keptNow(outcome: unknown, commit?: string): unknown {
  return attempted({
    attemptedAt: "2026-10-17T11:59:58.000000Z",
    ...(commit === undefined ? {} : { commit }),
    outcome,
  });
}

test("Import now stays working until the listing it redraws from has been read again", async () => {
  let answerListing: (answered: Response) => void = () => undefined;
  await drawPage({
    bound: [attempted()],
    relisted: new Promise<Response>((resolve) => {
      answerListing = resolve;
    }),
  });
  await press("Import now");
  expect(importOffered()?.textContent).toBe("Importing…");
  expect(importLine()).toBe("Last importNever");
  await turned(() => {
    answerListing(
      answer({
        repositories: [keptNow({ result: "Imported" }, attemptCommit)],
      }),
    );
  });
  await settled();
  expect(importOffered()?.textContent).toBe("Import now");
  expect(importLine()).toBe("Last importImported2s agocfaca0a");
});

test("a second Import now takes back what the first one said while it works", async () => {
  let answerSecond: (answered: Response) => void = () => undefined;
  await drawPage({
    bound: [attempted()],
    imported: [
      Promise.resolve(
        answer(
          {
            error: {
              code: "RepositoryConfigurationsRefused",
              message: "The repository configurations were refused.",
            },
            faults: [],
          },
          422,
        ),
      ),
      new Promise<Response>((resolve) => {
        answerSecond = resolve;
      }),
    ],
    boundAfter: [keptNow({ result: "DeclarationsRefused" }, attemptCommit)],
  });
  await press("Import now");
  const configurationsCard = sectionOf("Configurations");
  expect(within(configurationsCard).getByRole("status").textContent).toBe(
    "Not imported · Invalid",
  );
  await press("Import now");
  expect(importOffered()?.textContent).toBe("Importing…");
  expect(within(configurationsCard).queryByRole("status")).toBeNull();
  await turned(() => {
    answerSecond(answer({ imported: true }));
  });
  await settled();
});

/**
 * An empty repository is a miss and a repository declaring nothing a refusal,
 * yet each is kept and drawn as no fault, so the redrawn line says it alone.
 */
test.each([
  [
    "holds no commit",
    answer(
      { error: { code: "NotFound", message: "Resource not found." } },
      404,
    ),
    keptNow({ result: "SnapshotAbsent", absent: "Commit" }),
    "Last importEmpty2s ago",
  ],
  [
    "declares nothing",
    answer(
      {
        error: {
          code: "RepositoryConfigurationsAbsent",
          message: "The commit declares no configurations.",
        },
      },
      422,
    ),
    keptNow(
      { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
      attemptCommit,
    ),
    "Last importUndeclared2s agocfaca0a",
  ],
])(
  "Import now of a repository that %s says nothing under the line it redraws",
  async (_which, answered, kept, line) => {
    await drawPage({
      bound: [attempted()],
      imported: [Promise.resolve(answered)],
      boundAfter: [kept],
    });
    await press("Import now");
    expect(importLine()).toBe(line);
    expect(
      within(sectionOf("Configurations")).queryByRole("status"),
    ).toBeNull();
  },
);
