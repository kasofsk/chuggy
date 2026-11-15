/**
 * The starting configuration the setup program writes, against the import
 * itself: refused while a field it leaves blank is blank, and imported once
 * each is filled in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { repositoryConfigurationImportReadiness } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  setupBlankFields,
  setupConfigurationName,
  setupConfigurationPath,
  setupConfigurationStarting,
} from "../../ui/chuggy-ui/app/core/setupConfiguration.ts";

const repository = asRepositoryId("repository-one");
const commit = asGitObjectId("a".repeat(40));

function imported(text: string) {
  return repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [{ path: setupConfigurationPath, kind: "File", content: text }],
  });
}

function filledIn(text: string): string {
  const envelope = JSON.parse(text) as {
    configuration: {
      image: string;
      workloads: { checks: { commands: string[] } };
    };
  };
  envelope.configuration.image = "node:22";
  if (envelope.configuration.workloads.checks.commands.length === 0)
    envelope.configuration.workloads.checks.commands = ["npm test"];
  return JSON.stringify(envelope);
}

test("the starting configuration is refused by the import while it is blank, with or without a test command", () => {
  for (const test of [undefined, "npm test"]) {
    const found = imported(setupConfigurationStarting(test).text);
    assert.equal(found.readiness, "Refused", String(test));
  }
});

test("the starting configuration, once each field it leaves blank is filled in, is imported under its name", () => {
  for (const test of [undefined, "npm test"]) {
    const starting = setupConfigurationStarting(test);
    assert.deepEqual(
      starting.blanks.map((blank) => setupBlankFields[blank]),
      test === undefined
        ? ["configuration.image", "configuration.workloads.checks.commands"]
        : ["configuration.image"],
    );
    const found = imported(filledIn(starting.text));
    assert.equal(found.readiness, "Ready", String(test));
    assert.deepEqual(
      found.readiness === "Ready"
        ? found.declarations.map((held) => [held.name, held.path])
        : [],
      [[setupConfigurationName, setupConfigurationPath]],
    );
  }
});
