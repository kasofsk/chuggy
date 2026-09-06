/**
 * PageHead: a page's title, the identity beside it, and the row of standing
 * pills and controls under that — the shape `ThreadHead` and `LeadHead` share,
 * asserted with no provider around it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { PageHead } from "../app/browser/ui/PageHead.tsx";

afterEach(cleanup);

test("the title heads the identity, drawn short with the whole of it on hover", () => {
  const { container } = render(
    <PageHead
      title="Thread"
      identity={{ text: "sess-abc123", title: "sess-abc123-full" }}
    >
      <span>Open</span>
    </PageHead>,
  );
  expect(screen.getByRole("heading", { name: "Thread" })).toBeDefined();
  const identity = screen.getByTitle("sess-abc123-full");
  expect(identity.textContent).toBe("sess-abc123");
  expect(identity.classList.contains("identity")).toBe(true);
  expect(container.querySelector("[style]")).toBeNull();
});

test("the controls row holds every child passed to it", () => {
  const { container } = render(
    <PageHead title="Lead" identity={{ text: "s1", title: "s1" }}>
      <span>One</span>
      <span>Two</span>
    </PageHead>,
  );
  const controls = container.querySelector(".page-head-controls");
  expect(controls?.textContent).toBe("OneTwo");
});
