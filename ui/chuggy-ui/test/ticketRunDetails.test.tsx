// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
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
import { TicketRunPageAt } from "./ticketPageEveryTab.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

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

/** The run's own page under Details. */
async function details(served: RunPageServed): Promise<HTMLElement> {
  const drawn = await runPageDrawn(
    atlas,
    served,
    <TicketRunPageAt task={1} view="Details" />,
  );
  const body = drawn.container.querySelector<HTMLElement>(".ticket-run-body");
  if (body === null) throw new Error("no run drawn");
  return body;
}

/** What Details says against one name. */
function field(drawn: HTMLElement, name: string): string | null | undefined {
  return within(drawn).getByText(name, { selector: "dt" }).nextElementSibling
    ?.textContent;
}

test("a run's details say where and on what it ran, with no raw identity and no raw instant", async () => {
  const drawn = await details(
    passed([runAttempt("a1", { openedAt, endedAt })], [agentResult]),
  );
  expect(field(drawn, "Runner")).toBe("Linux · Amd64 · container");
  expect(field(drawn, "Image")).toBe("chuggy/worker");
  expect(field(drawn, "Worker")).toBe("Unknown");
  expect(field(drawn, "CPUs")).toBe("Default");
  expect(field(drawn, "Turns")).toBe("3");
  expect(field(drawn, "API time")).toBe("3m 20s");
  expect(field(drawn, "Tokens")).toBe(
    "10 in · 20 out · 30 cache write · 40 cache read",
  );
  const text = drawn.textContent;
  expect(text).not.toContain(execution);
  expect(text).not.toContain(manifest);
  expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d+/u);
  expect(text).not.toContain("+00");
  expect(text).not.toContain("agent-result");
});

test("the execution's identity is cut in the middle", async () => {
  const drawn = await details(
    passed([runAttempt("a1", { openedAt, endedAt })], [agentResult]),
  );
  expect(field(drawn, "Execution")).toBe("execution-17…c82b-1");
});

test("a run its fabric opened again counts every attempt it took", async () => {
  const drawn = await details(
    passed(
      [
        runAttempt("a0", {
          number: 1,
          state: "Lost",
          evidence: "LeaseExpired",
        }),
        runAttempt("a1", { number: 2, openedAt, endedAt }),
      ],
      [],
    ),
  );
  expect(field(drawn, "Attempts")).toBe("2");
});

test("a run waited from its registration to its first attempt's opening", async () => {
  const drawn = await details({
    ...passed([runAttempt("a1", { openedAt, endedAt })], []),
    execution: {
      ...runSummary({
        execution,
        registeredAt: "2026-08-27T00:00:00Z",
        startedAt: "2026-08-27T00:01:30Z",
      }),
      attempts: [runAttempt("a1")],
    },
  });
  expect(field(drawn, "Waited")).toBe("1m 30s");
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
