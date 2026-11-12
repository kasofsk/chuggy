/**
 * An evaluation approval answered from its inbox row: Approve sends at once,
 * Reject asks for feedback and cannot be sent blank, a reader it does not ask
 * reads what it awaits and from whom with nothing to press, and the bar's
 * badge counts the ticket it asks.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import type {
  InboxEntryResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import { InboxScreen } from "../app/browser/Inbox.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, settled, turned } from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { inboxAsked, inboxBody, inboxEntry } from "./inboxFixture.ts";
import { inboxShellMounted } from "./inboxShellHarness.tsx";
import { ticketInstants } from "./ticketInstants.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly children?: ReactNode;
    readonly "aria-label"?: string;
  }) => (
    <a href="/" aria-label={props["aria-label"]}>
      {props.children}
    </a>
  ),
  Outlet: () => <InboxScreen partition={atlas} />,
  useNavigate: () => () => undefined,
  useParams: () => atlas,
  useRouterState: (options: {
    readonly select: (state: {
      readonly location: {
        readonly pathname: string;
        readonly search: object;
      };
      readonly matches: readonly {
        readonly routeId: string;
        readonly params: object;
      }[];
    }) => unknown;
  }) =>
    options.select({
      location: { pathname: "/acme/atlas", search: {} },
      matches: [{ routeId: "/$tenant/$project/", params: atlas }],
    }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const instructions = "Check the release notes.";

function asking(answerable: boolean): ProjectNativeActionResponse {
  return {
    ticket: 11,
    action: "action-eval",
    kind: "EvaluationApproval",
    authorizingSequence: 51,
    admits: ["Approve", "Reject"],
    answerable,
    approval: {
      execution: "e-approval",
      workCycle: 2,
      stage: 1,
      generation: 1,
      evaluator: 1,
      instructions,
      approvers: "Developer",
    },
  };
}

const evaluating: ProjectTicket = {
  ticket: 11,
  title: "Land the release notes",
  phase: "Evaluation",
  sequence: 6,
  ...ticketInstants,
};

function awaiting(answerable = true): InboxEntryResponse {
  return inboxEntry(evaluating, { actions: [asking(answerable)] });
}

function mounted(inbox: () => readonly InboxEntryResponse[]) {
  return inboxShellMounted(atlas, (url) => {
    if (inboxAsked(url)) return answer(inboxBody(inbox()));
    if (url.includes("/executions")) return answer({ executions: [] });
    if (url.includes("/tenants/"))
      return answer({ partition: atlas, sequence: 9, tickets: [] });
    return answer({ projects: [atlas] });
  });
}

function question(): HTMLElement {
  return screen.getByRole("group", { name: "Stage 1 · Cycle 2" });
}

function badge(): string | undefined {
  const count =
    screen.queryByRole("link", { name: /^Inbox/u })?.textContent ?? "";
  return count === "" ? undefined : count;
}

test("a row asking its reader shows what to look at, is counted, and approves in place", async () => {
  const { api } = mounted(() => [awaiting()]);
  await settled();
  expect(badge()).toBe("1");
  expect(screen.getByText("awaiting your evaluation approval")).toBeDefined();
  expect(question().textContent).toContain(instructions);
  await turned(() => {
    within(question()).getByRole("button", { name: "Approve" }).click();
  });
  expect(api.submitted()).toMatchObject({
    mutation: {
      mutation: "ResolveNativeAction",
      action: "action-eval",
      authorizingSequence: 51,
      resolution: "Approve",
    },
  });
  expect((api.submitted() as { mutation: object }).mutation).not.toHaveProperty(
    "feedback",
  );
});

test("a row's rejection takes feedback, and is not sent blank", async () => {
  const { api } = mounted(() => [awaiting()]);
  await settled();
  const row = question();
  await turned(() => {
    within(row).getByRole("button", { name: "Reject" }).click();
  });
  const send = within(row)
    .getAllByRole("button", { name: "Reject" })
    .at(-1) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), {
    target: { value: "Name the breaking change." },
  });
  expect(
    screen.getByRole("group", { name: "Send this work back?" }),
  ).toBeDefined();
  await turned(() => {
    send.click();
  });
  expect(api.submissions()).toBe(1);
  expect(api.submitted()).toMatchObject({
    mutation: { resolution: "Reject", feedback: "Name the breaking change." },
  });
});

test("a row its reader may not answer says what it awaits and from whom, and offers no answer", async () => {
  mounted(() => [awaiting(false)]);
  await settled();
  expect(screen.getByText("awaiting evaluation approval")).toBeDefined();
  expect(
    screen.getByText("Any developer of this project", { exact: false }),
  ).toBeDefined();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  expect(screen.queryByRole("button", { name: "approve" })).toBeNull();
});

test("a frame settling the approval takes its row and its offer away", async () => {
  let entries: readonly InboxEntryResponse[] = [awaiting()];
  const { server } = mounted(() => entries);
  await settled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  entries = [];
  await turned(() => {
    server.push(
      frame("NativeAction", "12", {
        version: 1,
        resource: "11",
        representation: { actions: [] },
      }),
    );
  });
  await settled();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.getByText("Inbox is clear")).toBeDefined();
  expect(badge()).toBeUndefined();
});
