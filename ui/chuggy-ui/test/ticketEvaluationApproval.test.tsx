/**
 * The ticket page answering an evaluation approval: the header and the Needs
 * you card offer Approve and Reject where the action's own flag says the
 * reader may answer, a rejection is not sent without feedback, a reader the
 * approval does not ask reads what it awaits and from whom, and a frame
 * settling the action takes the offer away.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode, Ref } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  answer,
  apiDouble,
  openedStream,
  operationAt,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { abilitiesEvery, abilitiesOver } from "./projectAbilitiesFixture.ts";
import { runSummary } from "./runPageFixture.tsx";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import {
  TicketPageEveryTab,
  TicketRunPageAt,
  ticketHeader,
} from "./ticketPageEveryTab.tsx";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

beforeEach(() => {
  viewportAtEm(viewportDeskEm);
});

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly children?: ReactNode;
    readonly ref?: Ref<HTMLAnchorElement>;
  }) => (
    <a href="/" ref={props.ref}>
      {props.children}
    </a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const instructions = "Read the changelog wording.";

/** An approval evaluator's run in stage 1 of cycle 1, at the evaluator a case names. */
function approvalRun(
  execution: string,
  task: number,
  evaluator: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return runSummary({
    execution,
    task,
    taskKind: "Evaluation",
    identity: {
      type: "EvaluationTask",
      value: { ticket: 11, workCycle: 1, stage: 1, generation: 1, evaluator },
    },
    requirement: undefined,
    requirementDigest: undefined,
    requirementSource: undefined,
    platformDefaultVersion: undefined,
    runTotals: undefined,
    status: "Awaiting",
    outcome: undefined,
    ...over,
  });
}

/** The open action asking for the approval run `execution` stands for. */
function asking(
  action: string,
  execution: string,
  evaluator: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action,
    kind: "EvaluationApproval",
    authorizingSequence: 51,
    admits: ["Approve", "Reject"],
    answerable: true,
    approval: {
      execution,
      workCycle: 1,
      stage: 1,
      generation: 1,
      evaluator,
      instructions,
      approvers: "Developer",
    },
    ...over,
  };
}

const work = runSummary({ execution: "w1", task: 1 });

interface Served {
  readonly actions: readonly Record<string, unknown>[];
  readonly executions: readonly Record<string, unknown>[];
}

const servedOne: Served = {
  actions: [asking("action-eval", "e-approval", 1)],
  executions: [work, approvalRun("e-approval", 2, 1)],
};

/** The ticket in evaluation, its open actions gone once an answer is submitted. */
function serving(
  served: Served,
  submitted: () => unknown,
): (url: string) => Response {
  return (url) => {
    if (url.includes("/native-actions"))
      return answer({
        actions: submitted() === undefined ? served.actions : [],
      });
    const detail = /\/executions\/([^/?]+)/u.exec(url)?.[1];
    if (detail !== undefined) {
      const row = served.executions.find(
        (each) => each["execution"] === detail,
      );
      return row === undefined
        ? answer({}, 404)
        : answer({ ...row, attempts: [] });
    }
    if (url.includes("/executions"))
      return answer({ executions: served.executions });
    if (url.includes("/drafts/")) return answer({}, 404);
    return answer({
      ticket: 11,
      phase: "Evaluation",
      sequence: 51,
      program: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }, { key: 3 }] }],
      ...ticketInstants,
    });
  };
}

function mounted(
  served: Served = servedOne,
  over: (fetched: typeof fetch) => typeof fetch = (fetched) => fetched,
  page: ReactNode = <TicketPageEveryTab />,
): {
  readonly api: ReturnType<typeof apiDouble>;
  readonly server: ReturnType<typeof openedStream>;
} {
  const api = apiDouble({
    operation: operationAt("Succeeded"),
    route: (url) => serving(served, () => api.submitted())(url),
  });
  vi.stubGlobal("fetch", over(api.fetch));
  const server = openedStream();
  renderCopied(
    <ScreenHarness
      partition={atlas}
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
      transport={server.ports.fetch}
    >
      {page}
    </ScreenHarness>,
  );
  return { api, server };
}

function question(name = "Stage 1 · Cycle 1"): HTMLElement {
  return screen.getByRole("group", { name });
}

function typed(box: HTMLElement, value: string): void {
  fireEvent.change(box, { target: { value } });
}

test("the header approves an evaluation approval with no note asked of it", async () => {
  const held = mounted();
  await settled();
  const approve = within(ticketHeader()).getByRole("button", {
    name: "Approve",
  });
  expect(approve.classList.contains("btn-primary")).toBe(true);
  expect(
    within(ticketHeader()).getByRole("button", { name: "Reject" }),
  ).toBeDefined();
  await turned(() => {
    approve.click();
  });
  expect(held.api.submitted()).toStrictEqual({
    mutation: {
      mutation: "ResolveNativeAction",
      action: "action-eval",
      authorizingSequence: 51,
      resolution: "Approve",
    },
    operation: expect.any(String) as unknown,
  });
});

test("the card asks the step under evaluation, shows its instructions and who answers, and sends a note with the approve", async () => {
  const held = mounted();
  await settled();
  const card = screen.getByRole("status", { name: "Needs you" });
  expect(card.textContent).toContain("Awaiting evaluation approval");
  const asked = within(card).getByRole("group", { name: "Stage 1 · Cycle 1" });
  expect(asked.textContent).toContain(instructions);
  expect(asked.textContent).toContain("Any developer of this project");
  expect(within(asked).getByText("The work's result")).toBeDefined();
  expect(within(asked).getByText("Its artifacts")).toBeDefined();
  typed(within(asked).getByRole("textbox", { name: "Note" }), " Reads well ");
  await turned(() => {
    within(asked).getByRole("button", { name: "Approve" }).click();
  });
  expect(held.api.submitted()).toMatchObject({
    mutation: {
      mutation: "ResolveNativeAction",
      action: "action-eval",
      resolution: "Approve",
      feedback: "Reads well",
    },
  });
});

test("the card's rejection asks for feedback, and cannot be sent blank", async () => {
  const held = mounted();
  await settled();
  await turned(() => {
    within(question()).getByRole("button", { name: "Reject" }).click();
  });
  const confirm = within(question()).getByRole("group", {
    name: "Send this work back?",
  });
  const send = within(confirm).getByRole("button", { name: "Reject" });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  const feedback = within(confirm).getByRole("textbox", { name: "Feedback" });
  typed(feedback, "   ");
  expect((send as HTMLButtonElement).disabled).toBe(true);
  send.click();
  expect(held.api.submissions()).toBe(0);
  typed(feedback, "The changelog misses the new flag.");
  expect((send as HTMLButtonElement).disabled).toBe(false);
  await turned(() => {
    send.click();
  });
  expect(held.api.submitted()).toMatchObject({
    mutation: {
      action: "action-eval",
      resolution: "Reject",
      feedback: "The changelog misses the new flag.",
    },
  });
});

test("the header's rejection asks for feedback in a dialog, and cannot be sent blank", async () => {
  const held = mounted();
  await settled();
  await turned(() => {
    within(ticketHeader()).getByRole("button", { name: "Reject" }).click();
  });
  const dialog = screen.getByRole("dialog", { name: "Send this work back?" });
  const send = within(dialog).getByRole("button", { name: "Reject" });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  typed(
    within(dialog).getByRole("textbox", { name: "Feedback" }),
    "Split the commit.",
  );
  await turned(() => {
    send.click();
  });
  expect(held.api.submitted()).toMatchObject({
    mutation: { resolution: "Reject", feedback: "Split the commit." },
  });
});

function answersOffered(): number {
  return [
    ...screen.queryAllByRole("button", { name: "Approve" }),
    ...screen.queryAllByRole("button", { name: "Reject" }),
  ].length;
}

test("a reader the approval does not ask reads that it is awaited and from whom, and is offered no answer", async () => {
  mounted({
    ...servedOne,
    actions: [asking("action-eval", "e-approval", 1, { answerable: false })],
  });
  await settled();
  expect(answersOffered()).toBe(0);
  expect(screen.queryByRole("status", { name: "Needs you" })).toBeNull();
  const card = screen.getByRole("status", { name: "Awaiting approval" });
  expect(card.textContent).toContain("Awaiting evaluation approval");
  expect(card.textContent).toContain("Any developer of this project");
  expect(card.textContent).toContain(instructions);
});

test("a reader the approval lists by name reads the people it names", async () => {
  mounted({
    ...servedOne,
    actions: [
      asking("action-eval", "e-approval", 1, {
        answerable: false,
        approval: {
          ...(asking("action-eval", "e-approval", 1)["approval"] as object),
          approvers: ["dana", "eli"],
        },
      }),
    ],
  });
  await settled();
  const card = screen.getByRole("status", { name: "Awaiting approval" });
  expect(card.textContent).toContain("dana");
  expect(card.textContent).toContain("eli");
  expect(answersOffered()).toBe(0);
});

test("the action's flag decides: a reader who may not mutate but whom it asks is offered both answers", async () => {
  mounted(servedOne, abilitiesOver({ ...abilitiesEvery, mutate: false }));
  await settled();
  expect(
    within(ticketHeader()).getByRole("button", { name: "Approve" }),
  ).toBeDefined();
  expect(
    within(question()).getByRole("button", { name: "Reject" }),
  ).toBeDefined();
});

test("a frame settling the action takes the offer away, and the execution's frame redraws its row as answered", async () => {
  const answered = approvalRun("e-approval", 2, 1, {
    status: "Terminal",
    outcome: "Failed",
    terminalAt: "2026-08-27T00:05:00Z",
  });
  const executions: Record<string, unknown>[] = [
    work,
    approvalRun("e-approval", 2, 1),
  ];
  const served: Served = { actions: servedOne.actions, executions };
  const held = mounted(served);
  await settled();
  expect(answersOffered()).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("Waiting on a person");

  executions[1] = {
    ...answered,
    result: {
      manifest: "m1",
      approval: {
        action: "action-eval",
        principal: "fran",
        resolution: "Reject",
        answeredAt: "2026-08-27T00:05:00Z",
        feedback: "Needs a migration note.",
      },
      schemaVersion: 3,
      digest: "a".repeat(64),
      verdict: "Fail",
      recordedAt: "2026-08-27T00:05:00Z",
      artifacts: [],
    },
  };
  await turned(() => {
    held.server.push(
      frame("NativeAction", "12", {
        version: 1,
        resource: "11",
        representation: { actions: [] },
      }),
    );
    held.server.push(
      frame("Execution", "13", {
        version: 1,
        resource: "e-approval",
        representation: answered,
      }),
    );
  });
  await settled();
  expect(answersOffered()).toBe(0);
  expect(screen.queryByRole("status", { name: "Needs you" })).toBeNull();
  expect(document.body.textContent).toContain("Rejected by");
  expect(document.body.textContent).toContain("Needs a migration note.");
  expect(held.api.submitted()).toBeUndefined();
});

test("two open approvals beside a running evaluator are each asked by their own step, and the header answers neither", async () => {
  const held = mounted({
    actions: [
      asking("action-one", "e-one", 1),
      asking("action-two", "e-two", 2),
    ],
    executions: [
      work,
      approvalRun("e-one", 2, 1),
      approvalRun("e-two", 3, 2),
      runSummary({
        execution: "e-agent",
        task: 4,
        taskKind: "Evaluation",
        identity: {
          type: "EvaluationTask",
          value: {
            ticket: 11,
            workCycle: 1,
            stage: 1,
            generation: 1,
            evaluator: 3,
          },
        },
        status: "Running",
        outcome: undefined,
        carrier: "Agent",
        runStartedAt: "2026-08-27T00:01:00Z",
      }),
    ],
  });
  await settled();
  expect(
    within(ticketHeader()).queryByRole("button", { name: "Approve" }),
  ).toBeNull();
  const second = question("Stage 1 · 2 · Cycle 1");
  expect(question("Stage 1 · 1 · Cycle 1")).not.toBe(second);
  await turned(() => {
    within(second).getByRole("button", { name: "Approve" }).click();
  });
  expect(held.api.submitted()).toMatchObject({
    mutation: { action: "action-two", resolution: "Approve" },
  });
});

/** What a person's answer wrote as the run's result. */
function answeredBy(
  principal: string,
  resolution: "Approve" | "Reject",
  feedback: string,
): Record<string, unknown> {
  return {
    status: "Terminal",
    outcome: resolution === "Approve" ? "Passed" : "Failed",
    terminalAt: "2026-08-27T00:05:00Z",
    result: {
      manifest: "m1",
      approval: {
        action: `action-${principal}`,
        principal,
        resolution,
        answeredAt: "2026-08-27T00:05:00Z",
        feedback,
      },
      schemaVersion: 3,
      digest: "a".repeat(64),
      verdict: resolution === "Approve" ? "Pass" : "Fail",
      recordedAt: "2026-08-27T00:05:00Z",
      artifacts: [],
    },
  };
}

const answeredRows: Served = {
  actions: [asking("action-eval", "e-wait", 1)],
  executions: [
    work,
    approvalRun("e-wait", 2, 1),
    approvalRun("e-yes", 3, 2, answeredBy("dana", "Approve", "Reads well.")),
    approvalRun("e-no", 4, 3, answeredBy("eli", "Reject", "Add the flag.")),
  ],
};

/** The Runs tab's row named `name`, which is the link holding its name. */
function runsRow(name: string): HTMLElement {
  const named = [
    ...document.querySelectorAll<HTMLElement>(".ticket-runs-name"),
  ].find((each) => each.textContent === name);
  const row = named?.parentElement;
  if (row === null || row === undefined) throw new Error(`no row ${name}`);
  return row;
}

test("the Runs tab reads an approval waiting, approved and rejected, by whom, with what they said, and as no runner's", async () => {
  mounted(answeredRows);
  await settled();
  const waiting = runsRow("Stage 1 · 1");
  expect(waiting.textContent).toContain("Waiting on a person");
  expect(waiting.textContent).toContain("Asked");
  const approved = runsRow("Stage 1 · 2");
  expect(approved.textContent).toContain("Approved by");
  expect(approved.textContent).toContain("dana");
  expect(approved.textContent).toContain("Reads well.");
  expect(approved.textContent).toContain("Answered");
  const rejected = runsRow("Stage 1 · 3");
  expect(rejected.textContent).toContain("Rejected by");
  expect(rejected.textContent).toContain("Add the flag.");
  for (const row of [waiting, approved, rejected]) {
    expect(row.textContent).not.toMatch(/Queued|Running|Starting|Waiting \d/u);
    expect(row.textContent).not.toContain("No run figures");
  }
});

test("a withdrawn approval's row reads as withdrawn, and never as waiting or answered", async () => {
  mounted({
    actions: [],
    executions: [
      work,
      approvalRun("e-gone", 2, 1, {
        status: "Cancelled",
        terminalAt: "2026-08-27T00:05:00Z",
      }),
    ],
  });
  await settled();
  const withdrawn = runsRow("Stage 1");
  expect(withdrawn.textContent).toContain("Withdrawn without an answer");
  expect(withdrawn.textContent).not.toMatch(/Waiting|Answered|Asked/u);
});

test("an answered approval's page offers its Summary alone: who answered, when, and their feedback whole", async () => {
  mounted(answeredRows, undefined, <TicketRunPageAt task={4} />);
  await settled();
  const views = screen.getByRole("navigation", { name: "Run" });
  expect(
    within(views)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toStrictEqual(["Summary"]);
  const body = document.querySelector(".ticket-run-body");
  expect(body?.textContent).toContain("Rejected by");
  expect(body?.textContent).toContain("eli");
  expect(body?.textContent).toContain("Add the flag.");
  expect(document.querySelector(".ticket-run-head")?.textContent).toContain(
    "Rejected",
  );
});
