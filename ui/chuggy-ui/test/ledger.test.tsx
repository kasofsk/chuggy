/**
 * The four components a journal is drawn with, in every state each is total
 * over.
 *
 * A group's standing, a ghost row and an expander are each asserted through the
 * markup a reader's assistive technology walks — a `details`, a list, an
 * `aria-expanded` — rather than through the class that colours them, because
 * the class is the half a theme can change and the markup is the half it cannot.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useEffect } from "react";
import type { ReactNode } from "react";

import type { Figure as FigureValue, Spend } from "../app/core/figures.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { styleless } from "./styleless.ts";
import {
  Ledger,
  LedgerBlock,
  LedgerGroup,
  LedgerRow,
  ledgerStandings,
} from "../app/browser/ui/Ledger.tsx";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
}));

beforeEach(resizeObserverStubbed);

afterEach(() => {
  styleless();
  cleanup();
  vi.unstubAllGlobals();
});

const when: FigureValue = {
  kind: "Span",
  parts: ["started 20m ago", "ran 17m 40s"],
  open: false,
  title: "a → b",
};

const spent: Spend = {
  cost: { kind: "Cost", text: "$0.31", basis: "list" },
  tokens: { kind: "Tokens", text: "25k tok" },
};

test("both standings draw a group that is a disclosure, open where it is told", () => {
  for (const standing of ledgerStandings) {
    const { container } = render(
      <LedgerGroup
        title="Cycle 3"
        standing={standing}
        summary="Work passed"
        open={standing === "Current"}
      >
        <LedgerBlock>
          <LedgerRow label="Work" pill={{ tone: "pass", text: "Passed" }} />
        </LedgerBlock>
      </LedgerGroup>,
    );
    const group = container.querySelector("details");
    expect(group).not.toBeNull();
    expect(group?.open).toBe(standing === "Current");
    expect(
      group?.classList.contains(`ledger-group-${standing.toLowerCase()}`),
    ).toBe(true);
    expect(screen.getByText(standing)).toBeDefined();
    expect(container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

/** A lazy group's rows read on mount, so they mount at the first open and are
 * kept through every close after it rather than read again. */
test("a lazy group mounts its rows at the first open and keeps them through a close", () => {
  const mounted = vi.fn();
  function Counted(): ReactNode {
    useEffect(mounted, []);
    return <LedgerRow label="Work" pill={{ tone: "pass", text: "Passed" }} />;
  }
  const { container } = render(
    <LedgerGroup
      title="Cycle 2"
      standing="Superseded"
      summary="Work passed"
      open={false}
      lazy
    >
      <LedgerBlock>
        <Counted />
      </LedgerBlock>
    </LedgerGroup>,
  );
  const group = container.querySelector("details");
  if (group === null) throw new Error("no group drawn");
  const turned = (open: boolean): void => {
    group.open = open;
    fireEvent(group, new Event("toggle"));
  };
  expect(screen.queryByText("Work")).toBeNull();
  turned(true);
  expect(screen.getByText("Work")).toBeDefined();
  turned(false);
  expect(screen.getByText("Work")).toBeDefined();
  turned(true);
  expect(screen.getByText("Work")).toBeDefined();
  expect(mounted).toHaveBeenCalledTimes(1);
});

test("a row draws its label, its status, its window and its spend", async () => {
  const { container } = render(
    <LedgerBlock eyebrow="Evaluation" pill={{ tone: "live", text: "Current" }}>
      <LedgerRow
        label="Stage 1 of 2"
        identity={{ text: "b8bd…-7", title: "execution-b8bdfdd4-7" }}
        pill={{ tone: "fail", text: "Failed" }}
        when={when}
        spent={spent}
        note="Relaunched 3× by fabric"
      />
    </LedgerBlock>,
  );
  expect(screen.getByText("Stage 1 of 2")).toBeDefined();
  expect(screen.getByText("Failed")).toBeDefined();
  const identity = screen.getByText("b8bd…-7");
  fireEvent.focus(identity);
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "execution-b8bdfdd4-7",
  );
  expect(container.querySelector(".ledger-when")?.textContent).toContain(
    "17m 40s",
  );
  expect(container.querySelector(".ledger-spent")?.textContent).toContain(
    "$0.31",
  );
  expect(container.querySelector(".ledger-spent")?.textContent).toContain(
    "25k tok",
  );
  expect(screen.getByText("Relaunched 3× by fabric")).toBeDefined();
  expect(container.querySelector(".eyebrow")?.textContent).toBe("Evaluation");
});

test("a ghost row is marked as one and still carries a word", () => {
  const { container } = render(
    <LedgerBlock>
      <LedgerRow
        label="Stage 2 of 2"
        pill={{ tone: "retired", text: "Skipped" }}
        ghost
      />
    </LedgerBlock>,
  );
  expect(
    container.querySelector("li")?.classList.contains("ledger-row-ghost"),
  ).toBe(true);
  expect(screen.getByText("Skipped")).toBeDefined();
});

test("an expander says whether it is open and swaps its own word", () => {
  const toggled = vi.fn();
  const { rerender } = render(
    <LedgerBlock>
      <LedgerRow
        label="Work"
        pill={{ tone: "pass", text: "Passed" }}
        expands={[
          {
            label: "Details",
            hide: "Hide",
            open: false,
            onToggle: toggled,
            children: <p>detail</p>,
          },
        ]}
      />
    </LedgerBlock>,
  );
  const button = screen.getByRole("button", { name: "Details" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-pressed")).toBeNull();
  expect(screen.queryByText("detail")).toBeNull();
  fireEvent.click(button);
  expect(toggled).toHaveBeenCalledTimes(1);
  rerender(
    <LedgerBlock>
      <LedgerRow
        label="Work"
        pill={{ tone: "pass", text: "Passed" }}
        expands={[
          {
            label: "Details",
            hide: "Hide",
            open: true,
            onToggle: toggled,
            children: <p>detail</p>,
          },
        ]}
      />
    </LedgerBlock>,
  );
  expect(
    screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded"),
  ).toBe("true");
  expect(screen.getByText("detail")).toBeDefined();
});

/** Two open areas under one row would push the second a screen away from the
 * button that opened it, so the row holds one. */
test("a row's expanders share one detail area, the open one's", () => {
  const expander = (label: string, open: boolean) => ({
    label,
    hide: `Hide ${label.toLowerCase()}`,
    open,
    onToggle: vi.fn(),
    children: <p>{label} detail</p>,
  });
  const { container } = render(
    <LedgerBlock>
      <LedgerRow
        label="Work"
        pill={{ tone: "pass", text: "Passed" }}
        expands={[expander("Conversation", true), expander("Details", false)]}
      />
    </LedgerBlock>,
  );
  expect(
    [...container.querySelectorAll("button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Hide conversation", "Details"]);
  expect(container.querySelectorAll(".ledger-detail")).toHaveLength(1);
  expect(container.querySelector(".ledger-detail")?.textContent).toBe(
    "Conversation detail",
  );
});

test("a changed row is marked, and a short page says so above the groups", () => {
  const { container } = render(
    <Ledger truncated="Showing the first 7 executions">
      <LedgerBlock>
        <LedgerRow
          label="Stage 1 of 2"
          pill={{ tone: "live", text: "Running" }}
          changed
        />
      </LedgerBlock>
    </Ledger>,
  );
  expect(screen.getByText("Showing the first 7 executions")).toBeDefined();
  expect(
    container.querySelector("li")?.classList.contains("ledger-row-changed"),
  ).toBe(true);
});
