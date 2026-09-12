/**
 * Which of a project's revisions belong to one repository's page, and what each
 * row says.
 *
 * A project's listing holds every repository's revisions and every revision of
 * each name, so what is checked here is the narrowing: the page shows what this
 * repository declares now, and nothing it declared before.
 */

import { expect, test } from "vitest";

import { nativeHttpBasePath } from "../../../src/contract/http.ts";
import type { ConfigurationSummary } from "../../../src/contract/responses.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { configurationPagesMax } from "../app/core/apiRoutes.ts";
import {
  readProjectConfigurations,
  repositoryConfigurationRow,
  repositoryConfigurations,
  repositoryReadyConfiguration,
} from "../app/core/repositoryConfigurations.ts";
import { creationPartition, creationSummary } from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";

function declared(
  revision: string,
  repository: string,
  name: string,
  readiness: "Ready" | "Incomplete" = "Ready",
): ConfigurationSummary {
  const provenance: ConfigurationSummary["provenance"] = {
    source: "Repository",
    repository,
    commit: "cfaca0a0f14ec03845a4e01458ac6c3a56d52a23",
    path: `configurations/${name}.json`,
    name,
  };
  return { ...creationSummary(revision, readiness), provenance };
}

/** Newest first, which is the order the listing answers in. */
const listing = [
  declared("r6", chuggy, "chuggy"),
  declared("r5", scratch, "scratch"),
  declared("r4", chuggy, "nightly"),
  declared("r3", chuggy, "chuggy"),
  creationSummary("r2", "Ready"),
];

test("a page holds one row per name this repository declares, newest first", () => {
  expect(
    repositoryConfigurations(listing, chuggy).map(
      (summary) => summary.revision,
    ),
  ).toStrictEqual(["r6", "r4"]);
  expect(
    repositoryConfigurations(listing, scratch).map(
      (summary) => summary.revision,
    ),
  ).toStrictEqual(["r5"]);
  expect(repositoryConfigurations(listing, "https://forge.test/none")).toEqual(
    [],
  );
});

/** The initialization behind the Finalizer row is one revision's, and it must
 * be one this repository declares rather than the project's newest ready. */
test("the ready revision is this repository's own newest", () => {
  const held = [
    creationSummary("r9", "Ready"),
    declared("r6", chuggy, "chuggy", "Incomplete"),
    declared("r4", chuggy, "nightly"),
  ];
  expect(repositoryReadyConfiguration(held, chuggy)?.revision).toBe("r4");
  expect(repositoryReadyConfiguration(held, scratch)).toBe(undefined);
});

test("a ready row states four facts, and an incomplete one states none", () => {
  const ready = declared("r6", chuggy, "chuggy");
  expect(repositoryConfigurationRow(ready)).toStrictEqual({
    revision: "r6",
    configuration: { text: "r6", title: "r6" },
    facts: {
      worker: { text: "an-image", title: "an-image" },
      stages: "1",
      approval: "Not required",
      handoff: "None",
    },
  });
  expect(
    repositoryConfigurationRow(declared("r5", chuggy, "chuggy", "Incomplete"))
      .facts,
  ).toBe(undefined);
});

/**
 * The walk is what makes a repository's rows findable at all, and it is bounded
 * rather than run to the end of a project's history: a listing that never stops
 * paging would hang the page.
 */
test("the revisions are walked to the cursor's end, and no further than the budget", async () => {
  const calls: string[] = [];
  const ports: ApiPorts = {
    fetch: (path) => {
      calls.push(path);
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              configurations: [
                declared(`r${String(calls.length)}`, chuggy, "chuggy"),
              ],
              nextCursor: "more",
            }),
          ),
      } as unknown as Response);
    },
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
  const walked = await readProjectConfigurations(ports, creationPartition);
  expect(walked.outcome === "Ok" && walked.value.length).toBe(
    configurationPagesMax,
  );
  expect(calls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/atlas/configurations`,
  );
  expect(calls.length).toBe(configurationPagesMax);
});

test("a refused page is the answer, and no rows are drawn from a partial read", async () => {
  const ports: ApiPorts = {
    fetch: () =>
      Promise.resolve({
        status: 403,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ code: "Forbidden" })),
      } as unknown as Response),
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
  const walked = await readProjectConfigurations(ports, creationPartition);
  expect(walked.outcome).not.toBe("Ok");
});
