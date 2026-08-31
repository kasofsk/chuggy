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
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { Figure as FigureValue, Spend } from "../app/core/figures.ts";
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

afterEach(cleanup);

const when: FigureValue = {
  kind: "Span",
  start: "10:31",
  length: "17m 40s",
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

test("a row draws its label, its status, its window and its spend", () => {
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
  expect(screen.getByTitle("execution-b8bdfdd4-7").textContent).toBe("b8bd…-7");
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
        expand={{ open: false, onToggle: toggled, children: <p>detail</p> }}
      />
    </LedgerBlock>,
  );
  const button = screen.getByRole("button", { name: "Details" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByText("detail")).toBeNull();
  fireEvent.click(button);
  expect(toggled).toHaveBeenCalledTimes(1);
  rerender(
    <LedgerBlock>
      <LedgerRow
        label="Work"
        pill={{ tone: "pass", text: "Passed" }}
        expand={{ open: true, onToggle: toggled, children: <p>detail</p> }}
      />
    </LedgerBlock>,
  );
  expect(
    screen.getByRole("button", { name: "Hide" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByText("detail")).toBeDefined();
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
