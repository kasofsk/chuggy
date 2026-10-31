/**
 * The card of a ticket parked by a failed step, where the step's worker kept
 * text: its first line under the step's own line, and the whole of it below,
 * drawn on the page rather than held for a hover; and no more than the step's
 * line where the worker kept none.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, within, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { runAttempt, runPageDrawn, runSummary } from "./runPageFixture.tsx";
import type { RunPageServed } from "./runPageFixture.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
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

/** A refused push as git tells it, whose cause is past its first line. */
const pushRefused = [
  "git push failed with exit status 1",
  "To github.com:acme/atlas.git",
  " ! [remote rejected] chug/11 -> chug/11 (refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission)",
  "error: failed to push some refs to 'github.com:acme/atlas.git'",
].join("\n");

/** A ticket parked where its run's push failed, its worker's text served
 * where it kept any. */
function pushFailed(content: string | undefined): RunPageServed {
  const kept = content === undefined ? {} : { error: { bytes: 300 } };
  const summary = runSummary({ outcome: "ProcessFailed" });
  return {
    ticket: {
      ticket: 11,
      phase: "Escalated",
      sequence: 7,
      escalation: {
        kind: "WorkFailureEscalated",
        resumeAt: "ResumeWork",
        failed: {
          evidence: "RunPushFailed",
          execution: "e1",
          attempt: "a1",
          ...kept,
        },
      },
      ...ticketInstants,
    },
    executions: [summary],
    execution: { ...summary, attempts: [runAttempt("a1")] },
    transcripts: [],
    ...(content === undefined
      ? {}
      : { error: { read: "Content", content: `${content}\n` } }),
  };
}

test("a ticket parked on a failed push draws the whole of its worker's text, and no hover", async () => {
  await runPageDrawn(atlas, pushFailed(pushRefused));
  const card = screen.getByRole("status", { name: "Needs you" });
  const line = card.querySelector(".ticket-card-reason");
  expect(line?.textContent).toBe("git push failed with exit status 1");
  expect(line?.hasAttribute("title")).toBe(false);
  const whole = within(card).getByText(/remote rejected/u);
  expect(whole.textContent).toBe(pushRefused);
  expect(whole.classList.contains("whitespace-pre-wrap")).toBe(true);
  expect(card.querySelector("[title]")).toBeNull();
});

test("a ticket parked on a failed push whose worker kept no text draws only the step's line", async () => {
  const rendered = await runPageDrawn(atlas, pushFailed(undefined));
  const card = screen.getByRole("status", { name: "Needs you" });
  expect(card.querySelector(".ticket-card-reason")).toBeNull();
  expect(card.querySelector(".whitespace-pre-wrap")).toBeNull();
  expect(within(card).getByText("Push failed")).toBeTruthy();
  expect(rendered.reads.filter((url) => url.endsWith("/error"))).toEqual([]);
});
