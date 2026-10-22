/**
 * The configurations the Catalog page chooses among: each name once with its
 * versions newest first, the page opening on a catalog, and the address read
 * back into a choice.
 */

import { expect, test } from "vitest";

import type { ConfigurationSummary } from "../../../src/contract/responses.ts";
import {
  catalogConfigurationHolding,
  catalogConfigurationOpening,
  catalogConfigurationsOf,
  catalogQueryOf,
} from "../app/core/catalogConfigurations.ts";

function summary(
  revision: string,
  name: string,
  number: number,
  catalog: boolean,
): ConfigurationSummary {
  return {
    revision,
    digest: "a".repeat(64),
    createdAt: "2026-10-01T00:00:00Z",
    provenance: {
      source: "Repository",
      repository: "https://forge.test/kasofsk/chuggy",
      commit: "c".repeat(40),
      path: `.chug/configurations/${name}.json`,
      name,
    },
    version: { name, number },
    readiness: "Ready",
    image: "an-image",
    practices: [],
    finalization: { approvalRequired: false },
    evaluationStagesCount: 1,
    ...(catalog
      ? {
          catalog: {
            workloads: ["build"],
            plans: ["review"],
            finalizers: [],
            defaults: { work: "build", evaluation: "review" },
          },
        }
      : {}),
  };
}

const listed = [
  summary("r5", "basic", 3, false),
  summary("r4", "dev", 2, true),
  summary("r3", "basic", 2, false),
  summary("r2", "dev", 1, true),
];

test("each name is listed once, in the order it last changed, its versions newest first", () => {
  expect(
    catalogConfigurationsOf(listed).map((configuration) => [
      configuration.name,
      configuration.versions.map((version) => version.revision),
    ]),
  ).toStrictEqual([
    ["basic", ["r5", "r3"]],
    ["dev", ["r4", "r2"]],
  ]);
});

test("the page opens on the newest catalog, and on the newest configuration where none is one", () => {
  expect(catalogConfigurationOpening(catalogConfigurationsOf(listed))).toBe(
    "r4",
  );
  expect(
    catalogConfigurationOpening(
      catalogConfigurationsOf([summary("r1", "basic", 1, false)]),
    ),
  ).toBe("r1");
  expect(catalogConfigurationOpening([])).toBeUndefined();
});

test("an older version is found under the name it is a version of", () => {
  expect(
    catalogConfigurationHolding(catalogConfigurationsOf(listed), "r2")?.name,
  ).toBe("dev");
  expect(
    catalogConfigurationHolding(catalogConfigurationsOf(listed), "r9"),
  ).toBeUndefined();
});

test("the address keeps only the choices it names as text", () => {
  expect(
    catalogQueryOf({ configuration: "r4", entry: "plans/review" }),
  ).toStrictEqual({
    configuration: "r4",
    entry: "plans/review",
  });
  expect(catalogQueryOf({ configuration: "", entry: 7 })).toStrictEqual({});
});
