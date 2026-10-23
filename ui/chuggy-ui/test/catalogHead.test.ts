/**
 * The repository's head against the newest import of a configuration: matched
 * and differing by digest, absent, refused, or never read.
 */

import { expect, test } from "vitest";

import type { RepositoryConfigurationHeadResponse } from "../../../src/contract/responses.ts";
import {
  catalogHeadStandingOf,
  catalogHeadText,
} from "../app/core/catalogHead.ts";

const at = { branch: "main", commit: "e".repeat(40) } as const;

function ready(digest: string): RepositoryConfigurationHeadResponse["head"] {
  return {
    state: "Ready",
    ...at,
    configurations: [
      {
        name: "work",
        path: ".chug/configurations/basic-coding.json",
        revision: "r1",
        canonical: "{}",
        digest,
      },
    ],
  };
}

test("a head declaring the newest import's digest matches it, and any other differs", () => {
  expect(catalogHeadStandingOf(ready("a"), "work", "a").standing).toBe(
    "Matches",
  );
  expect(catalogHeadStandingOf(ready("b"), "work", "a").standing).toBe(
    "Differs",
  );
});

test("a head declaring other configurations, or none, declares no such one", () => {
  expect(catalogHeadStandingOf(ready("a"), "other", "a")).toStrictEqual({
    standing: "Undeclared",
    at: ready("a"),
  });
  expect(
    catalogHeadText(
      catalogHeadStandingOf(
        { state: "ConfigurationsAbsent", ...at },
        "work",
        "a",
      ),
      "work",
    ),
  ).toBe("The repository's main at eeeeeee declares no work.");
});

test("a head that could not be read says why, and names no commit", () => {
  expect(
    catalogHeadText(
      catalogHeadStandingOf({ state: "BranchAbsent" }, "work", "a"),
      "work",
    ),
  ).toBe("The repository has no default branch to read.");
  expect(
    catalogHeadStandingOf(
      { state: "SnapshotRefused", ...at, refused: "Credential" },
      "work",
      "a",
    ),
  ).toStrictEqual({ standing: "Unread", why: "SnapshotRefused" });
});
