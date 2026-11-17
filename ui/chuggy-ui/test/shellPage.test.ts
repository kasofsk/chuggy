/**
 * What the shell says of the page a reader is on: the document's title, the
 * page first and the project last, read from the bar's trail; and whether a
 * move takes the reader's focus to the page.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { projectNamed } from "../app/core/projectNaming.ts";
import type { ShellCrumbNames } from "../app/core/shellCrumbs.ts";
import { shellPageFocused, shellPageTitle } from "../app/core/shellPage.ts";
import { workspaceNames } from "../app/core/workspaceNames.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

/** Lists that have not answered, so the project is named by its address. */
const unnamed: ShellCrumbNames = {
  workspace: workspaceNames({ state: "Pending" }),
  project: (partition) => projectNamed(undefined, partition),
};

test("each page's title names the page first and the project last", () => {
  expect(shellPageTitle(atlas, "/acme/atlas", unnamed)).toBe("tickets · atlas");
  expect(shellPageTitle(atlas, "/acme/atlas/inbox", unnamed)).toBe(
    "inbox · atlas",
  );
  expect(shellPageTitle(atlas, "/acme/atlas/epics", unnamed)).toBe(
    "epics · atlas",
  );
  expect(shellPageTitle(atlas, "/acme/atlas/tickets/7", unnamed)).toBe(
    "7 · tickets · atlas",
  );
  expect(shellPageTitle(atlas, "/acme/atlas/tickets/7/runs/3", unnamed)).toBe(
    "3 · runs · 7 · tickets · atlas",
  );
  expect(
    shellPageTitle(atlas, "/acme/atlas/settings/workspace/runner", unnamed),
  ).toBe("runner · workspace · settings · atlas");
});

test("a title spells the address's segments decoded, as the trail does", () => {
  const spaced: PartitionIdentity = { tenant: "acme", project: "big atlas" };
  expect(shellPageTitle(spaced, "/acme/big%20atlas/epics/E%201", unnamed)).toBe(
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

test("a title ends with the project's name where its list gives one", () => {
  const named: ShellCrumbNames = {
    ...unnamed,
    project: (partition) =>
      projectNamed(
        [{ tenant: "acme", project: "atlas", name: "Atlas Web" }],
        partition,
      ),
  };
  expect(shellPageTitle(atlas, "/acme/atlas/inbox", named)).toBe(
    "inbox · Atlas Web",
  );
});
