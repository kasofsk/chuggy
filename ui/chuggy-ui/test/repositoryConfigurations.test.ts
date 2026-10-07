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
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { configurationPagesMax } from "../app/core/apiRoutes.ts";
import {
  readProjectConfigurations,
  repositoryConfigurationRow,
  repositoryConfigurations,
} from "../app/core/repositoryConfigurations.ts";
import {
  creationDeclared as declared,
  creationPartition,
  creationSummary,
} from "./ticketCreationFixture.ts";

const chuggy = "https://forge.test/kasofsk/chuggy";
const scratch = "https://forge.test/gdoteof/scratch";

const older = "0b5c1d0e9a7f4c3b2a1908f7e6d5c4b3a2f1e0d9";

/** Newest first, which is the order the listing answers in. */
const listing = [
  declared("r6", chuggy, "chuggy"),
  declared("r5", scratch, "scratch"),
  declared("r4", chuggy, "nightly"),
  declared("r3", chuggy, "chuggy", "Ready", older),
  creationSummary("r2", "Ready"),
];

test("a page holds what this repository's newest commit declares, in the listing's order", () => {
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

/** An import writes every declaration of its commit, so a name the newest
 * commit lacks is one the repository stopped declaring. */
test("a name the newest commit no longer declares is not a row", () => {
  const held = [
    declared("r9", chuggy, "nightly"),
    declared("r8", chuggy, "chuggy"),
    declared("r7", chuggy, "dropped", "Ready", older),
    declared("r6", chuggy, "nightly", "Ready", older),
    declared("r5", chuggy, "chuggy", "Ready", older),
  ];
  expect(
    repositoryConfigurations(held, chuggy).map((summary) => summary.revision),
  ).toStrictEqual(["r9", "r8"]);
});

test("a ready row states three facts, and an incomplete one states none", () => {
  const ready = declared("r6", chuggy, "chuggy");
  expect(repositoryConfigurationRow(ready)).toStrictEqual({
    revision: "r6",
    configuration: { text: "r6", title: "r6" },
    facts: {
      worker: { text: "an-image", title: "an-image" },
      stages: "1",
      approval: "Not required",
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
function pagingPorts(
  calls: string[],
  page: (call: number) => Record<string, unknown>,
): ApiPorts {
  return {
    fetch: (path) => {
      calls.push(path);
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(page(calls.length))),
      } as unknown as Response);
    },
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
}

test("the revisions are walked to the cursor's end, and no further than the budget", async () => {
  const calls: string[] = [];
  const ports = pagingPorts(calls, (call) => ({
    configurations: [declared(`r${String(call)}`, chuggy, "chuggy")],
    nextCursor: "more",
  }));
  const walked = await readProjectConfigurations(ports, creationPartition);
  expect(walked.outcome === "Ok" && walked.value.configurations.length).toBe(
    configurationPagesMax,
  );
  expect(walked.outcome === "Ok" && walked.value.partial).toBe(true);
  expect(calls[0]).toBe(
    `${nativeHttpBasePath}/tenants/acme/projects/atlas/configurations`,
  );
  expect(calls.length).toBe(configurationPagesMax);
});

test("a walk the cursor ended read all of it", async () => {
  const calls: string[] = [];
  const ports = pagingPorts(calls, (call) => ({
    configurations: [declared(`r${String(call)}`, chuggy, "chuggy")],
    nextCursor: call === 2 ? undefined : "more",
  }));
  const walked = await readProjectConfigurations(ports, creationPartition);
  expect(walked.outcome === "Ok" && walked.value.partial).toBe(false);
  expect(calls.length).toBe(2);
});

/**
 * A budget that stops over another repository's revisions reads as this one
 * declaring nothing, which is the reading the flag exists to stop.
 */
test("a walk stopped by the budget says so, whether or not it drew rows", async () => {
  const calls: string[] = [];
  const ports = pagingPorts(calls, () => ({
    configurations: [],
    nextCursor: "more",
  }));
  const walked = await readProjectConfigurations(ports, creationPartition);
  expect(walked.outcome === "Ok" && walked.value.configurations).toStrictEqual(
    [],
  );
  expect(walked.outcome === "Ok" && walked.value.partial).toBe(true);
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
