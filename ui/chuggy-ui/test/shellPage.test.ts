/**
 * What the shell says of the page a reader is on: the document's title, the
 * page first and the project last, read from the bar's trail; and whether a
 * move takes the reader's focus to the page.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { shellPageFocused, shellPageTitle } from "../app/core/shellPage.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

test("each page's title names the page first and the project last", () => {
  expect(shellPageTitle(atlas, "/acme/atlas")).toBe("tickets · atlas");
  expect(shellPageTitle(atlas, "/acme/atlas/inbox")).toBe("inbox · atlas");
  expect(shellPageTitle(atlas, "/acme/atlas/epics")).toBe("epics · atlas");
  expect(shellPageTitle(atlas, "/acme/atlas/tickets/7")).toBe(
    "7 · tickets · atlas",
  );
  expect(shellPageTitle(atlas, "/acme/atlas/tickets/7/runs/3")).toBe(
    "3 · runs · 7 · tickets · atlas",
  );
  expect(shellPageTitle(atlas, "/acme/atlas/settings/workspace/runner")).toBe(
    "runner · workspace · settings · atlas",
  );
});

test("a title spells the address's segments decoded, as the trail does", () => {
  const spaced: PartitionIdentity = { tenant: "acme", project: "big atlas" };
  expect(shellPageTitle(spaced, "/acme/big%20atlas/epics/E%201")).toBe(
    "E 1 · epics · big atlas",
  );
});

test("focus moves to the page only on a move to another page", () => {
  expect(shellPageFocused(undefined, "/acme/atlas", false)).toBe(false);
  expect(shellPageFocused("/acme/atlas", "/acme/atlas", false)).toBe(false);
  expect(shellPageFocused("/acme/atlas", "/acme/atlas/inbox", false)).toBe(
    true,
  );
});

test("focus held in the chat pane stays there when its thread moves the pages", () => {
  expect(shellPageFocused("/acme/atlas", "/acme/atlas/inbox", true)).toBe(
    false,
  );
});
