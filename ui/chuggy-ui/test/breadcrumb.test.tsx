/**
 * The breadcrumb: a link to the page a drill-down was reached from, and the
 * separator that reads it against the title beside it.
 *
 * The router is stubbed, as `ButtonLink`'s own suite stubs it, so the link is
 * drawn with no provider around it.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Breadcrumb, BreadcrumbLink } from "../app/browser/ui/Breadcrumb.tsx";
import { styleless } from "./styleless.ts";

interface LinkStub {
  readonly className?: string;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: (props: LinkStub) => ReactNode) => component,
}));

afterEach(cleanup);

test("a breadcrumb is a labelled nav holding its one link and a separator", () => {
  const view = render(
    <Breadcrumb>
      <BreadcrumbLink to="/">Overview</BreadcrumbLink>
    </Breadcrumb>,
  );
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  const link = screen.getByText("Overview");
  expect(link.tagName).toBe("A");
  expect(nav.textContent).toBe("Overview/");
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});
