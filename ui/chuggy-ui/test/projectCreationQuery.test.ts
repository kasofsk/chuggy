/**
 * The project creation address's own reader and writer: the workspace the
 * form starts on, as the router parsed it, nothing where the address names
 * none or names what no workspace is called, and an address written for a
 * name read back as that name whatever the router makes of its letters.
 */

import { defaultParseSearch } from "@tanstack/react-router";
import { expect, test } from "vitest";

import { projectNameCharsMax } from "../../../src/contract/requests.ts";
import {
  projectCreationPathIn,
  projectCreationQueryOf,
  projectCreationRoutePath,
} from "../app/core/projectCreation.ts";

const none = { workspace: undefined };

test("an address naming no workspace starts the form on none, and says so by the key", () => {
  expect(projectCreationQueryOf({})).toStrictEqual(none);
});

test("a workspace the address names is the one the form starts on", () => {
  expect(projectCreationQueryOf({ workspace: "northwind" })).toStrictEqual({
    workspace: "northwind",
  });
});

test.each([
  ["a number", 123],
  ["a truth", true],
  ["nothing", null],
  ["a list", ["northwind"]],
  ["empty text", ""],
  ["text no workspace is called", "North Wind"],
  ["a name past the longest", "n".repeat(projectNameCharsMax + 1)],
])("%s names no workspace", (_, workspace) => {
  expect(projectCreationQueryOf({ workspace })).toStrictEqual(none);
});

test("what else the address carries is not read", () => {
  expect(
    projectCreationQueryOf({ workspace: "northwind", other: 9 }),
  ).toStrictEqual({ workspace: "northwind" });
});

test("the address written for a workspace is the form's own, the name in its query", () => {
  expect(projectCreationPathIn("northwind")).toBe(
    `${projectCreationRoutePath}?workspace=northwind`,
  );
});

test("a name the router would read as a number is written quoted, the quotes as an address carries them", () => {
  expect(projectCreationPathIn("123")).toBe(
    `${projectCreationRoutePath}?workspace=%22123%22`,
  );
});

test.each(["northwind", "123", "true", "false", "null", "1e3", "0-0", "007"])(
  "the address written for a workspace named %s is read back by the router as that name",
  (name) => {
    const [, query] = projectCreationPathIn(name).split("?");
    expect(
      projectCreationQueryOf(defaultParseSearch(query ?? "")),
    ).toStrictEqual({ workspace: name });
  },
);
