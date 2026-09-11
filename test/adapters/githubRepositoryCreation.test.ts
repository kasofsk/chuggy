/**
 * Making a repository on GitHub: where each mode is made, what the first commit
 * says, what the ruleset reserves, and how each status is read.
 *
 * EVERY STATUS CLASSIFICATION IS ASSERTED PER ACT. A forge answers a name
 * already taken, a permission never granted and a fault it has no words for
 * with statuses that overlap, so each act's reading of each of them is its own
 * case: an implementation that collapsed `Exists` into `Refused`, or an outage
 * into either, fails here rather than on a repository somebody then has to
 * delete by hand.
 *
 * THE REQUEST IS ASSERTED AS THE FORGE RECEIVES IT. The address, the method and
 * the body are what decide whether a personal account was sent to the
 * organization endpoint, whether the seed named the branch that was made, and
 * whether the ruleset lets this app past and nothing else — none of which is
 * visible in the outcome.
 *
 * A REFUSED MINT IS A REFUSAL AND CARRIES NO FORGE MESSAGE, because there was
 * no forge request to carry one out of: the app is not installed with what the
 * act needs, which is the one refusal this side words itself.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { githubRepositoryCreation } from "../../src/adapters/forge/githubRepositoryCreation.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
  asForgeRepositoryName,
  type ForgeInstallation,
  type ForgeInstallationTokens,
  type ForgeTokenMinted,
  type ForgeTokenRequest,
} from "../../src/interpreter/forgeInstallation.ts";
import { asGitRefName } from "../../src/interpreter/finalizer.ts";
import { fixtureForge, type ForgeRecorder } from "./forgeFixtures.ts";

const fixtureAppId = "4708055";
const fixtureApiUrl = "https://forge.invalid";
const fixtureName = asForgeRepositoryName("engine");
const fixtureBranch = asGitRefName("refs/heads/main");

const fixtureInstallation: ForgeInstallation = {
  forge: asForgeId("github"),
  app: asForgeApp("portal"),
  account: asForgeAccount("kasofsk"),
  installationId: asForgeInstallationId("156333284"),
};

const fixtureTemplate = {
  account: asForgeAccount("kasofsk"),
  name: asForgeRepositoryName("chuggy-template"),
};

const fixtureGranted: ForgeTokenMinted = {
  minted: "Token",
  token: asForgeInstallationToken("ghs-creation-a1b2c3"),
  expiresAtMs: 4_102_444_800_000,
};

function fixtureTokens(
  minted: ForgeTokenMinted,
  asked: ForgeTokenRequest[] = [],
): ForgeInstallationTokens {
  return {
    mint: (request) => {
      asked.push(request);
      return Promise.resolve(minted);
    },
  };
}

function fixtureCreation(
  recorder: ForgeRecorder,
  tokens: ForgeInstallationTokens = fixtureTokens(fixtureGranted),
) {
  return githubRepositoryCreation({
    fetch: recorder.requestFetch,
    apiUrl: fixtureApiUrl,
    appId: fixtureAppId,
    tokens,
  });
}

function fixtureAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** One made repository as the forge describes it. */
function fixtureMade(): Response {
  return fixtureAnswer(201, {
    clone_url: "https://github.com/kasofsk/engine.git",
    default_branch: "main",
  });
}

function fixtureCreate() {
  return {
    installation: fixtureInstallation,
    name: fixtureName,
    visibility: "private" as const,
  };
}

function fixtureSeed() {
  return {
    installation: fixtureInstallation,
    name: fixtureName,
    branch: fixtureBranch,
    path: ".chug/configurations/bootstrap.json",
    message: "Add the bootstrap chuggy configuration",
    content: "{}\n",
  };
}

test("an organization's repository is made in the organization's own collection", async () => {
  const recorder = fixtureForge([fixtureMade()]);
  const asked: ForgeTokenRequest[] = [];
  const made = await fixtureCreation(
    recorder,
    fixtureTokens(fixtureGranted, asked),
  ).create({ ...fixtureCreate(), creation: { mode: "Organization" } });
  assert.deepEqual(made, {
    created: "Repository",
    repository: {
      url: "https://github.com/kasofsk/engine.git",
      defaultBranch: "refs/heads/main",
    },
  });
  const [call] = recorder.calls;
  assert.equal(call?.url, `${fixtureApiUrl}/orgs/kasofsk/repos`);
  assert.equal(call?.method, "POST");
  assert.equal(call?.redirect, "error");
  assert.deepEqual(JSON.parse(call?.body ?? ""), {
    name: "engine",
    private: true,
    auto_init: false,
  });
  assert.deepEqual(asked[0]?.permissions, "administer");
});

test("a personal account's repository is generated from the template", async () => {
  const recorder = fixtureForge([fixtureMade()]);
  const made = await fixtureCreation(recorder).create({
    ...fixtureCreate(),
    creation: { mode: "Template", template: fixtureTemplate },
  });
  assert.equal(made.created, "Repository");
  const [call] = recorder.calls;
  assert.equal(
    call?.url,
    `${fixtureApiUrl}/repos/kasofsk/chuggy-template/generate`,
  );
  assert.deepEqual(JSON.parse(call?.body ?? ""), {
    owner: "kasofsk",
    name: "engine",
    private: true,
  });
});

test("a name already taken is its own answer and carries no message", async () => {
  const recorder = fixtureForge([
    fixtureAnswer(422, {
      message: "Repository creation failed.",
      errors: [{ message: "name already exists on this account" }],
    }),
  ]);
  const made = await fixtureCreation(recorder).create({
    ...fixtureCreate(),
    creation: { mode: "Organization" },
  });
  assert.deepEqual(made, { created: "Exists" });
});

test("a refused create carries the forge's own account of it", async () => {
  const recorder = fixtureForge([
    fixtureAnswer(403, { message: "Resource not accessible by integration" }),
  ]);
  const made = await fixtureCreation(recorder).create({
    ...fixtureCreate(),
    creation: { mode: "Organization" },
  });
  assert.deepEqual(made, {
    created: "Refused",
    message: "Resource not accessible by integration",
  });
});

test("a status the create did not ask for is an outage", async () => {
  const recorder = fixtureForge([fixtureAnswer(500, { message: "sorry" })]);
  const made = await fixtureCreation(recorder).create({
    ...fixtureCreate(),
    creation: { mode: "Organization" },
  });
  assert.deepEqual(made, { created: "Unavailable" });
});

test("an answer the create cannot read as a repository is an outage", async () => {
  const recorder = fixtureForge([fixtureAnswer(201, { clone_url: "" })]);
  const made = await fixtureCreation(recorder).create({
    ...fixtureCreate(),
    creation: { mode: "Organization" },
  });
  assert.deepEqual(made, { created: "Unavailable" });
});

test("a mint this app was refused is a refusal worded this side", async () => {
  const recorder = fixtureForge([]);
  const made = await fixtureCreation(
    recorder,
    fixtureTokens({ minted: "Denied" }),
  ).create({ ...fixtureCreate(), creation: { mode: "Organization" } });
  assert.equal(made.created, "Refused");
  assert.equal(recorder.calls.length, 0);
});

test("a mint that could not be made is an outage", async () => {
  const recorder = fixtureForge([]);
  const made = await fixtureCreation(
    recorder,
    fixtureTokens({ minted: "Unavailable" }),
  ).create({ ...fixtureCreate(), creation: { mode: "Organization" } });
  assert.deepEqual(made, { created: "Unavailable" });
});

test("the seed writes the file at the branch the repository was made with", async () => {
  const recorder = fixtureForge([fixtureAnswer(201, { content: {} })]);
  const seeded = await fixtureCreation(recorder).seed(fixtureSeed());
  assert.deepEqual(seeded, { seeded: "Seeded" });
  const [call] = recorder.calls;
  assert.equal(
    call?.url,
    `${fixtureApiUrl}/repos/kasofsk/engine/contents/.chug/configurations/bootstrap.json`,
  );
  assert.equal(call?.method, "PUT");
  const body = JSON.parse(call?.body ?? "") as Record<string, unknown>;
  assert.equal(body["branch"], "main");
  assert.equal(body["message"], "Add the bootstrap chuggy configuration");
  assert.equal(
    Buffer.from(String(body["content"]), "base64").toString("utf8"),
    "{}\n",
  );
});

test("a seed the forge refused carries its message", async () => {
  const recorder = fixtureForge([fixtureAnswer(404, { message: "Not Found" })]);
  const seeded = await fixtureCreation(recorder).seed(fixtureSeed());
  assert.deepEqual(seeded, { seeded: "Refused", message: "Not Found" });
});

test("a seed the forge did not answer is an outage", async () => {
  const recorder = fixtureForge([fixtureAnswer(502, {})]);
  const seeded = await fixtureCreation(recorder).seed(fixtureSeed());
  assert.deepEqual(seeded, { seeded: "Unavailable" });
});

test("a reference this forge cannot spell as a branch is refused before it is sent", async () => {
  const recorder = fixtureForge([]);
  const seeded = await fixtureCreation(recorder).seed({
    ...fixtureSeed(),
    branch: asGitRefName("refs/tags/v1"),
  });
  assert.equal(seeded.seeded, "Refused");
  assert.equal(recorder.calls.length, 0);
});

test("the ruleset reserves the default branch to this app and the administrators", async () => {
  const recorder = fixtureForge([fixtureAnswer(201, { id: 1 })]);
  const reserved = await fixtureCreation(recorder).reserveDefaultBranch({
    installation: fixtureInstallation,
    name: fixtureName,
  });
  assert.deepEqual(reserved, { created: "Ruleset" });
  const [call] = recorder.calls;
  assert.equal(call?.url, `${fixtureApiUrl}/repos/kasofsk/engine/rulesets`);
  const body = JSON.parse(call?.body ?? "") as Record<string, unknown>;
  assert.equal(body["target"], "branch");
  assert.equal(body["enforcement"], "active");
  assert.deepEqual(body["conditions"], {
    ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
  });
  assert.deepEqual(body["rules"], [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "update" },
  ]);
  assert.deepEqual(body["bypass_actors"], [
    {
      actor_id: Number(fixtureAppId),
      actor_type: "Integration",
      bypass_mode: "always",
    },
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
  ]);
});

test("a refused ruleset carries its message and an unanswered one is an outage", async () => {
  const refusing = fixtureForge([
    fixtureAnswer(422, { message: "Rulesets are not available" }),
  ]);
  assert.deepEqual(
    await fixtureCreation(refusing).reserveDefaultBranch({
      installation: fixtureInstallation,
      name: fixtureName,
    }),
    { created: "Refused", message: "Rulesets are not available" },
  );
  const failing = fixtureForge([fixtureAnswer(503, {})]);
  assert.deepEqual(
    await fixtureCreation(failing).reserveDefaultBranch({
      installation: fixtureInstallation,
      name: fixtureName,
    }),
    { created: "Unavailable" },
  );
});

test("an app identity that is not one is refused at construction", () => {
  const recorder = fixtureForge([]);
  assert.throws(
    () =>
      githubRepositoryCreation({
        fetch: recorder.requestFetch,
        apiUrl: fixtureApiUrl,
        appId: "chuggy-portal",
        tokens: fixtureTokens(fixtureGranted),
      }),
    RangeError,
  );
});
