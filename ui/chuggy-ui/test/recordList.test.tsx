/**
 * The record list: a row's title is a link inside a heading at the level it is
 * handed, every row has the same parts whichever it was given, the pages a
 * list reads are rows of the one list with "show more" after it, and a
 * skeleton row has a row's parts and is hidden from a reader.
 *
 * The router is stubbed, so the links are drawn with no provider around them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import {
  RecordList,
  RecordRow,
  RecordRowSkeleton,
} from "../app/browser/ui/RecordList.tsx";
import { styleless } from "./styleless.ts";

vi.mock("@tanstack/react-router", () => import("./routerLinkStubbed.tsx"));

afterEach(cleanup);

const recordListTicket = {
  to: "/$tenant/$project/tickets/$ticket",
  params: { tenant: "acme", project: "console", ticket: "335" },
} as const;

function recordListRows(count: number): ReactNode[] {
  return Array.from({ length: count }, (_, index) => (
    <RecordRow
      key={index}
      title={`Record ${String(index + 1)}`}
      link={{ to: "/" }}
      level={3}
    />
  ));
}

/** Each row's parts, by class, in the order the row draws them. */
function recordListParts(item: Element): string[] {
  return [...item.querySelectorAll("[class^='record-row-']")]
    .map((part) =>
      part.className.split(" ").filter((name) => name !== "record-row-bone"),
    )
    .flat();
}

test("a row's title is a link to its record inside a heading at the level handed", () => {
  render(
    <RecordList label="Records">
      <RecordRow
        title="Lock the contract"
        link={recordListTicket}
        level={2}
        meta={<span>#335</span>}
      />
    </RecordList>,
  );
  const heading = screen.getByRole("heading", { level: 2 });
  const link = screen.getByRole("link", { name: "Lock the contract" });
  expect(heading.contains(link)).toBe(true);
  expect(link.getAttribute("href")).toBe(recordListTicket.to);
  expect(screen.getByRole("list", { name: "Records" })).toBeTruthy();
  styleless();
});

test("a row given no meta, trailing or foot still draws the line and the foot that hold its height", () => {
  render(
    <RecordList label="Records">
      <RecordRow title="Bare" link={{ to: "/" }} level={3} />
      <RecordRow
        title="Full"
        link={{ to: "/" }}
        level={3}
        meta={<span>meta</span>}
        trailing={<span>chip</span>}
        foot={<span>Ready</span>}
      />
    </RecordList>,
  );
  const [bare, full] = screen.getAllByRole("listitem");
  if (bare === undefined || full === undefined) throw new Error("two rows");
  expect(recordListParts(bare)).toEqual([
    "record-row-head",
    "record-row-title",
    "record-row-line",
    "record-row-meta",
    "record-row-foot",
  ]);
  expect(
    recordListParts(full).filter((part) => part !== "record-row-trailing"),
  ).toEqual(recordListParts(bare));
  expect(full.querySelector(".record-row-trailing")?.textContent).toBe("chip");
});

test("a page read by show more joins the one list, and show more stands after it", () => {
  let asked = 0;
  const more = {
    label: "Show more",
    onMore: () => {
      asked += 1;
    },
  };
  const view = render(
    <RecordList label="Records" more={more}>
      {recordListRows(2)}
    </RecordList>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(asked).toBe(1);
  view.rerender(
    <RecordList label="Records" more={more}>
      {recordListRows(4)}
    </RecordList>,
  );
  const lists = screen.getAllByRole("list");
  expect(lists).toHaveLength(1);
  const list = lists[0];
  expect(list?.children).toHaveLength(4);
  expect(list?.lastElementChild?.textContent).toBe("Record 4");
  const button = screen.getByRole("button", { name: "Show more" });
  expect(list?.contains(button)).toBe(false);
  expect(
    (list?.compareDocumentPosition(button) ?? 0) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  view.rerender(<RecordList label="Records">{recordListRows(4)}</RecordList>);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("a skeleton row has a row's parts, and no reader is told of it", () => {
  render(
    <RecordList label="Records">
      <RecordRowSkeleton />
      {recordListRows(1)}
    </RecordList>,
  );
  const list = screen.getByRole("list", { name: "Records" });
  const [skeleton, row] = [...list.children];
  if (skeleton === undefined || row === undefined) throw new Error("two rows");
  expect(skeleton.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryAllByRole("heading")).toHaveLength(1);
  expect(recordListParts(skeleton)).toEqual(recordListParts(row));
  expect(skeleton.querySelectorAll(".record-row-bone")).toHaveLength(2);
});
