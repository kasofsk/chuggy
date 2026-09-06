/**
 * The page head: a title, the identity it stands for drawn through `Identity`,
 * and the row of standing controls beside them.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { PageHead } from "../app/browser/ui/PageHead.tsx";

afterEach(cleanup);

test("the head names its title and draws the identity through Identity", () => {
  const view = render(
    <PageHead
      title="Thread"
      identity={{ text: "thread-session-1", title: "thread-session-1" }}
    >
      <button>Close</button>
    </PageHead>,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Thread" }),
  ).toBeDefined();
  const identity = view.container.querySelector(".identity");
  expect(identity?.textContent).toBe("thread-session-1");
  expect(identity?.getAttribute("title")).toBe("thread-session-1");
  expect(
    view.container
      .querySelector(".page-head-controls")
      ?.contains(screen.getByRole("button", { name: "Close" })),
  ).toBe(true);
});

test("a head with no controls draws an empty row rather than nothing", () => {
  const view = render(
    <PageHead
      title="Lead"
      identity={{ text: "lead-session-1", title: "lead-session-1" }}
    />,
  );
  expect(view.container.querySelector(".page-head-controls")?.textContent).toBe(
    "",
  );
});
