// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  runAttempt,
  runDigest,
  runPageDrawn,
  runSummary,
  runTotals,
  runTranscriptPage,
} from "./runPageFixture.tsx";
import type { RunPageServed } from "./runPageFixture.tsx";
import { settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Identities and instants as the rig's API answers them. */
const execution = "execution-170132a7-b3b0-4ff0-8ce0-78622ff3c82b-1";
const manifest = "manifest-fda15e5d-349f-43c2-8f2e-eae30042c8e6";
const openedAt = "2026-10-01 15:32:48.356468+00";
const endedAt = "2026-10-01 15:35:36.366517+00";

const ticket = {
  ticket: 11,
  phase: "Done",
  sequence: 7,
  runTotals: runTotals(180_000),
  ...ticketInstants,
};

function artifact(
  ordinal: number,
  path: string,
  bytes: number,
): Record<string, unknown> {
  return { ordinal, role: "Diagnostic", path, digest: runDigest, bytes };
}

const agentResult = artifact(0, ".chuggy/agent-result.json", 5072);

function passed(
  attempts: readonly Record<string, unknown>[],
  artifacts: readonly Record<string, unknown>[],
): RunPageServed {
  const summary = runSummary({ execution });
  return {
    ticket,
    executions: [summary],
    execution: {
      ...summary,
      attempts,
      result: {
        manifest,
        attempt: "a1",
        schemaVersion: 3,
        digest: runDigest,
        verdict: "Pass",
        recordedAt: endedAt,
        artifacts,
        report: "Added the README lines.",
      },
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  };
}

/** The ticket page with its work row's details open. */
async function details(served: RunPageServed): Promise<HTMLElement> {
  await runPageDrawn(atlas, served);
  await turned(() => {
    screen.getAllByRole("button", { name: "Details" })[0]?.click();
  });
  await settled();
  return screen.getByRole("region", { name: "Runs" });
}

test("a passed run's details draw no raw identity, no raw instant and no warning for its own result", async () => {
  const drawn = await details(
    passed([runAttempt("a1", { openedAt, endedAt })], [agentResult]),
  );
  expect(drawn.querySelector(".panel-absent")).toBeNull();
  const text = drawn.textContent;
  expect(text).toContain("Passed");
  expect(text).toContain("Added the README lines.");
  expect(text).not.toContain(execution);
  expect(text).not.toContain(manifest);
  expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d+/u);
  expect(text).not.toContain("+00");
  expect(text).not.toContain("agent-result");
});

test("the execution's identity is one press away, whole", async () => {
  const drawn = await details(
    passed([runAttempt("a1", { openedAt, endedAt })], [agentResult]),
  );
  await turned(() => {
    within(drawn).getByRole("button", { name: "Execution ID" }).click();
  });
  expect(
    Array.from(drawn.querySelectorAll("code")).map((code) => code.textContent),
  ).toContain(execution);
});

/** Opened that many minutes before the case runs, so its ago reads in minutes. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function cellTexts(row: HTMLElement): readonly string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

test("an execution with two attempts draws two rows told apart by number, state, start and length", async () => {
  const lostOpenedAt = minutesAgo(20);
  const reportedOpenedAt = minutesAgo(10);
  const drawn = await details(
    passed(
      [
        runAttempt("a0", {
          number: 1,
          state: "Lost",
          evidence: "LeaseExpired",
          openedAt: lostOpenedAt,
          endedAt: new Date(Date.parse(lostOpenedAt) + 30_000).toISOString(),
        }),
        runAttempt("a1", {
          number: 2,
          openedAt: reportedOpenedAt,
          endedAt: new Date(
            Date.parse(reportedOpenedAt) + 168_000,
          ).toISOString(),
        }),
      ],
      [],
    ),
  );
  const table = within(drawn).getByRole("table", { name: "Runs" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  const [lost, reported] = rows.map((row) => ({
    run: within(row).getByRole("rowheader").textContent,
    cells: cellTexts(row),
  }));
  expect(lost?.run).toBe("1");
  expect(reported?.run).toBe("2");
  expect(lost?.cells[0]).toBe("Lost");
  expect(reported?.cells[0]).toBe("Reported");
  expect(lost?.cells[1]).toMatch(/^20m( \d{2}s)? ago$/u);
  expect(reported?.cells[1]).toMatch(/^10m( \d{2}s)? ago$/u);
  expect(lost?.cells[2]).toBe("30s");
  expect(reported?.cells[2]).toBe("2m 48s");
});

/** A diagnostic a worker uploads that no task output declares. */
const undeclared = artifact(0, ".chuggy/lint-output.txt", 1234);

/** An artifact declared under an `Image` output, as the result lists it. */
const screenshot = {
  ...artifact(0, "artifacts/screenshot.png", 24),
  output: {
    name: "screenshot",
    path: "artifacts/screenshot.png",
    mediaType: "image/png",
    renderer: "Image",
  },
};

test("an Image artifact previews as an img of a data URI carrying its declared media type", async () => {
  const drawn = await details({
    ...passed([runAttempt("a1", { openedAt, endedAt })], [screenshot]),
    artifactContent: {
      read: "Content",
      mediaType: "image/png",
      renderer: "Image",
      encoding: "Base64",
      content: "QQ==",
    },
  });
  const row = within(drawn).getByText("artifacts/screenshot.png")
    .parentElement as HTMLElement;
  await turned(() => {
    within(row).getByRole("button", { name: "Preview" }).click();
  });
  await settled();
  const image = within(row).getByRole("img", {
    name: "artifacts/screenshot.png",
  });
  expect(image.getAttribute("src")).toBe("data:image/png;base64,QQ==");
  expect(row.querySelector("pre.preview")).toBeNull();
});

test("an undeclared artifact other than the run's result keeps its row, with a quiet note", async () => {
  const drawn = await details(
    passed([runAttempt("a1", { openedAt, endedAt })], [undeclared]),
  );
  const row = within(drawn).getByText(".chuggy/lint-output.txt").parentElement;
  expect(row?.textContent).toContain("Diagnostic");
  expect(row?.textContent).toContain("1,234 bytes");
  const note = within(row as HTMLElement).getByText("No preview");
  expect(note.className).not.toMatch(/panel-absent|tone-parked|tone-fail/u);
});

/** An artifact declared under an output a case names, with its preview opened. */
async function previewed(
  path: string,
  renderer: string,
  content: string,
): Promise<HTMLElement> {
  const declared = {
    ...artifact(0, path, content.length),
    output: { name: "notes", path, mediaType: "text/plain", renderer },
  };
  const drawn = await details({
    ...passed([runAttempt("a1", { openedAt, endedAt })], [declared]),
    artifactContent: {
      read: "Content",
      mediaType: "text/plain",
      renderer,
      encoding: "Utf8",
      content,
    },
  });
  const row = within(drawn).getByText(path).parentElement as HTMLElement;
  await turned(() => {
    within(row).getByRole("button", { name: "Preview" }).click();
  });
  await settled();
  return row;
}

test("a Markdown output previews as markdown", async () => {
  const row = await previewed(
    "out/notes.md",
    "Markdown",
    "- one\n- two\n\nRun `just check`.",
  );
  const drawn = row.querySelector('[data-renderer="Markdown"]');
  expect(drawn?.querySelectorAll("ul > li")).toHaveLength(2);
  expect(drawn?.querySelector("code")?.textContent).toBe("just check");
  expect(row.querySelector("pre.preview")).toBeNull();
});

test("a Markdown output carrying a tag, a script address and an image draws none of them live", async () => {
  const row = await previewed(
    "out/notes.md",
    "Markdown",
    '<b onclick="alert(1)">bold</b> [go](javascript:alert(1)) ![x](https://example.com/x.png)',
  );
  const drawn = row.querySelector('[data-renderer="Markdown"]');
  expect(drawn).not.toBeNull();
  expect(drawn?.querySelector("b, img, script, [onclick]")).toBeNull();
  expect(
    Array.from(drawn?.querySelectorAll("a") ?? []).filter((link) =>
      (link.getAttribute("href") ?? "").startsWith("javascript"),
    ),
  ).toEqual([]);
});

test("a Json output previews indented", async () => {
  const row = await previewed("out/coverage.json", "Json", '{"lines":[1,2]}');
  expect(row.querySelector('pre[data-renderer="Json"]')?.textContent).toBe(
    '{\n  "lines": [\n    1,\n    2\n  ]\n}',
  );
});
