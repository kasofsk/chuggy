/**
 * The canonical configuration document, read into what the panel draws.
 *
 * The three shapes a repository declaration actually takes — no worker at all,
 * a worker with no model pinned, and one with a model pinned — are read from
 * the files themselves rather than a copied fixture, so a shape those files
 * change reaches this suite without anyone updating it by hand. What follows
 * them is the reader refusing nothing: a document that is not JSON, one with
 * nothing in it, and the two ways a `worker.mode` can fail to say what this
 * reads for a `SingleAgent` Claude run.
 */

import { expect, test } from "vitest";

import {
  configurationViewOf,
  practiceLabel,
} from "../app/core/configurationView.ts";

/** Every declared configuration's raw text, read at build time by Vite rather
 * than by Node's own `fs`, since `.chug/` is a dot directory a glob skips
 * unless told to search it. */
const declarations = import.meta.glob<string>(
  "../../../.chug/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);

function declaredConfiguration(name: string): string {
  const path = `../../../.chug/configurations/${name}.json`;
  const raw = declarations[path];
  if (raw === undefined)
    throw new Error(`no configuration declared as ${name}`);
  const declaration: unknown = JSON.parse(raw);
  const body = (declaration as { readonly configuration: unknown })
    .configuration;
  return JSON.stringify(body);
}

test("a repository configuration authoring no worker states no worker-only field", () => {
  const view = configurationViewOf(declaredConfiguration("basic-coding"));
  expect(view.settings).toStrictEqual({
    model: { label: "Default", argument: undefined },
    agent: undefined,
    agentDetail: undefined,
    worker: { short: "worker:v1", full: "worker:v1" },
    tools: undefined,
    credentials: undefined,
    access: undefined,
    setup: undefined,
    completesTask: undefined,
  });
  expect(view.evaluations).toStrictEqual([
    {
      purpose: "Check",
      checks: [".chug/tasks/ci.sh"],
      instructions: undefined,
      practices: undefined,
    },
    {
      purpose: "Review",
      checks: undefined,
      instructions: [
        "Read .chug/tasks/review-change.md and review the change exactly as that brief requires.",
      ],
      practices: ["ChangedCallPaths", "AcceptanceCriteria"],
    },
  ]);
});

test("a pinned tool flag is read ahead of the authority's own list", () => {
  const view = configurationViewOf(declaredConfiguration("chuggy-development"));
  expect(view.settings.model).toStrictEqual({
    label: "Default",
    argument: undefined,
  });
  expect(view.settings.agent).toBe("Claude Code");
  expect(view.settings.agentDetail).toBe("Single agent");
  expect(view.settings.tools).toStrictEqual([
    "Bash",
    "Edit",
    "Read",
    "Write",
    "Glob",
    "Grep",
  ]);
  expect(view.settings.credentials).toStrictEqual([
    "chuggy-github-worker",
    "claude-code",
  ]);
  expect(view.settings.access).toBe("Network · Workspace writable");
  expect(view.settings.setup).toStrictEqual(["npm ci"]);
  expect(view.settings.completesTask).toBe(false);
  expect(view.work.practices).toStrictEqual([
    "RegressionCoverage",
    "AcceptanceCriteria",
  ]);
});

test("a pinned model is read from its own flag and shown capitalised", () => {
  const view = configurationViewOf(
    declaredConfiguration("chuggy-development-opus"),
  );
  expect(view.settings.model).toStrictEqual({
    label: "Opus",
    argument: "--model=opus",
  });
});

test("bytes that are not JSON draw an emptier configuration, not a failed one", () => {
  const view = configurationViewOf("not json");
  expect(view.settings.model).toStrictEqual({
    label: "Default",
    argument: undefined,
  });
  expect(view.settings.worker).toBeUndefined();
  expect(view.brief).toStrictEqual({
    motivation: [],
    acceptanceCriteria: [],
    constraints: [],
  });
  expect(view.work).toStrictEqual({
    instructions: undefined,
    commands: undefined,
    practices: undefined,
  });
  expect(view.evaluations).toStrictEqual([]);
});

test("a document with nothing in it reads the same as one with nothing readable", () => {
  expect(configurationViewOf("{}")).toStrictEqual(
    configurationViewOf("not json"),
  );
});

/** `taskConfigurationWorkerModeSchema` admits only `SingleAgent`; this reader
 * is not that schema, so a document naming another mode still reads what it
 * can rather than refusing the whole worker block. */
test("a mode other than SingleAgent still reads its own type, not an agent it never named", () => {
  const view = configurationViewOf(
    JSON.stringify({ worker: { mode: { type: "Commands" } } }),
  );
  expect(view.settings.agent).toBeUndefined();
  expect(view.settings.agentDetail).toBe("Commands");
  expect(view.settings.model).toStrictEqual({
    label: "Default",
    argument: undefined,
  });
});

test("arguments naming no model read as the default, and the tool flag alone", () => {
  const view = configurationViewOf(
    JSON.stringify({
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Claude",
          arguments: ["--allowedTools=Bash"],
        },
      },
    }),
  );
  expect(view.settings.model).toStrictEqual({
    label: "Default",
    argument: undefined,
  });
  expect(view.settings.tools).toStrictEqual(["Bash"]);
});

/** Codex refuses `--model` among its arguments; its mode names the model and
 * the worker passes it, so the field is what the run is given. */
test("a Codex mode's model is read from its own field, as named", () => {
  const view = configurationViewOf(
    JSON.stringify({
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Codex",
          model: "gpt-5-codex",
          arguments: [],
        },
      },
    }),
  );
  expect(view.settings.model).toStrictEqual({
    label: "gpt-5-codex",
    argument: undefined,
  });
});

/** The briefing's own rule: a role that runs commands is briefed with no
 * practices, a role naming its own is briefed with those, and any other with
 * the configuration's. */
test("each role shows the practices it is briefed with", () => {
  const view = configurationViewOf(
    JSON.stringify({
      practices: ["RegressionCoverage"],
      work: { commands: ["just build"] },
      review: { instructions: ["Review it."] },
    }),
  );
  expect(view.work.practices).toStrictEqual([]);
  expect(view.review.practices).toStrictEqual(["RegressionCoverage"]);
  const own = configurationViewOf(
    JSON.stringify({
      practices: ["RegressionCoverage"],
      work: { instructions: ["Build it."], practices: ["Layering"] },
    }),
  );
  expect(own.work.practices).toStrictEqual(["Layering"]);
});

test("a practice identity is drawn as the words it names", () => {
  expect(practiceLabel("RegressionCoverage")).toBe("Regression coverage");
  expect(practiceLabel("ChangedCallPaths")).toBe("Changed call paths");
  expect(practiceLabel("AcceptanceCriteria")).toBe("Acceptance criteria");
});

/** An identity this cannot split into words is drawn as itself, never as
 * nothing — the same tolerance the rest of the reader keeps. */
test("a practice identity with no words of its own is drawn as itself", () => {
  expect(practiceLabel("custom")).toBe("custom");
});
