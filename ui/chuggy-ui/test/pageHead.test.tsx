/**
 * The page head: a title beside its identity, and the row of standing
 * controls under that — the shape a thread page and a lead page both draw
 * their own heads from.
 *
 * What is asserted is that the identity is drawn through `Identity` itself
 * rather than a second rendering of a session id, since that is the half of
 * this primitive a stylesheet snapshot cannot tell apart from a hand-rolled
 * one.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { PageHead } from "../app/browser/ui/PageHead.tsx";
import { Pill } from "../app/browser/ui/Pill.tsx";

afterEach(cleanup);

test("the title heads the page, the identity sits beside it, and the controls draw below", () => {
  const view = render(
    <PageHead
      title="Thread"
      identity={{ text: "thread-abc123", title: "thread-abc123-full" }}
    >
      <Pill tone="live">Mine</Pill>
    </PageHead>,
  );
  expect(screen.getByRole("heading", { name: "Thread" })).toBeDefined();
  const identity = screen.getByTitle("thread-abc123-full");
  expect(identity.textContent).toBe("thread-abc123");
  expect(screen.getByText("Mine")).toBeDefined();
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("the identity is Identity's own markup, not a second drawing of a session id", () => {
  render(
    <PageHead title="Lead" identity={{ text: "lead-1", title: "lead-1" }}>
      <Pill tone="parked">Escalated</Pill>
    </PageHead>,
  );
  expect(document.querySelector(".identity")).not.toBeNull();
  expect(document.querySelector(".lead-session")).toBeNull();
  expect(document.querySelector(".thread-session")).toBeNull();
});
