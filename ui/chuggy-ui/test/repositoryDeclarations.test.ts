/**
 * What a bound repository's declarations come to as lines, which is the half
 * the page draws rather than reads.
 */

import { expect, test } from "vitest";

import {
  repositoryDeclaredCommit,
  repositoryDeclaredRosters,
} from "../app/core/repositoryDeclarations.ts";

const commit = "a".repeat(40);

const declared = {
  repository: "https://forge.test/kasofsk/chuggy",
  commit,
  reworkLimit: 5,
  executionProfiles: ["coding", "review"],
  finalizers: ["pull-request.yaml"],
};

test("the rosters are stated in the order a ticket meets them", () => {
  expect(repositoryDeclaredRosters(declared)).toStrictEqual([
    { name: "Execution profiles", members: ["coding", "review"] },
    { name: "Finalizers", members: ["pull-request.yaml"] },
  ]);
});

/** An empty roster is still a roster, so the section has a name to say it under. */
test("a roster the repository declares nothing in is empty and not absent", () => {
  const rosters = repositoryDeclaredRosters({
    ...declared,
    executionProfiles: [],
    finalizers: [],
  });
  expect(rosters.map((roster) => roster.name)).toStrictEqual([
    "Execution profiles",
    "Finalizers",
  ]);
  expect(rosters.every((roster) => roster.members.length === 0)).toBe(true);
});

/** The whole commit is what a reader compares with a forge, so it is not lost. */
test("the commit is drawn short and titled with the whole of itself", () => {
  expect(repositoryDeclaredCommit(declared)).toStrictEqual({
    text: "aaaaaaaaaaaa",
    title: commit,
  });
});
