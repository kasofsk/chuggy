/**
 * What a form overrides of its configuration and the body that sends it: the
 * fields the contract lets a ticket override, the model written through the
 * mode in each shape a mode names one, and a field given back.
 *
 * The documents with a mode naming its model as an argument and naming none
 * are the ones this repository declares, read from `.chug/configurations/`
 * rather than copied.
 */

import { expect, test } from "vitest";

import { configurationOverridesSchema } from "../../../src/contract/configurationOverrides.ts";
import {
  creationBodyFrom,
  creationConfigurationChosen,
} from "../app/core/ticketCreation.ts";
import {
  overrideFields,
  overrideHeld,
  overrideModelChosen,
  overrideModelConfigured,
  overrideModelDrawn,
  overrideModelSays,
  overridesHeldOf,
} from "../app/core/ticketOverrides.ts";
import type { CreationOverrides } from "../app/core/ticketOverrides.ts";
import {
  creationForm,
  creationOffer,
  creationOffers,
  creationSummary,
} from "./ticketCreationFixture.ts";

const declarations = import.meta.glob<string>(
  "../../../.chug/configurations/*.json",
  { query: "?raw", import: "default", eager: true, exhaustive: true },
);

function declared(name: string): unknown {
  const raw = declarations[`../../../.chug/configurations/${name}.json`];
  if (raw === undefined) throw new Error(`no ${name} configuration declared`);
  return (JSON.parse(raw) as { readonly configuration: unknown }).configuration;
}

/** A mode naming its model as an argument. */
const sonnet = declared("chuggy-development-sonnet");
/** A mode naming no model. */
const basic = declared("basic-coding");
/** A mode carrying a model field of its own. */
const codex = {
  worker: {
    mode: {
      type: "SingleAgent",
      agent: "Codex",
      arguments: [],
      model: "gpt-5",
    },
  },
};

function modeOf(document: unknown): unknown {
  return (document as { readonly worker: { readonly mode: unknown } }).worker
    .mode;
}

test("the fields drawn are every one the contract's schema lets a ticket override", () => {
  expect(overrideFields).toStrictEqual([
    "worker.mode",
    "worker.setup",
    "worker.files",
    "practices",
    "brief.motivation",
    "brief.acceptanceCriteria",
    "brief.constraints",
    "work.instructions",
  ]);
  const everything = Object.fromEntries(
    overrideFields.map((field) => [
      field,
      field === "worker.mode" ? modeOf(codex) : [],
    ]),
  ) as CreationOverrides;
  const body = creationBodyFrom(
    creationOffers,
    creationForm({ overrides: everything }),
    [],
  );
  expect(body.assembled).toBe("Body");
  expect(
    configurationOverridesSchema.safeParse(
      body.assembled === "Body" ? body.body.overrides : undefined,
    ).success,
  ).toBe(true);
});

test.each([
  [
    "names its model as an argument",
    sonnet,
    {
      ...(modeOf(sonnet) as object),
      arguments: [
        "--allowedTools=Bash,Edit,Read,Write,Glob,Grep",
        "--model=opus",
      ],
    },
  ],
  [
    "names no model",
    basic,
    {
      ...(modeOf(basic) as object),
      arguments: [
        "--allowedTools=Bash,Edit,Read,Write,Glob,Grep",
        "--model=opus",
      ],
    },
  ],
  [
    "carries a model field",
    codex,
    { ...(modeOf(codex) as object), model: "opus" },
  ],
])(
  "a model typed under a mode that %s overrides the mode with the model alone changed",
  (_said, document, mode) => {
    expect(overrideModelChosen({}, document, "opus")).toStrictEqual({
      "worker.mode": mode,
    });
  },
);

test("typing the configuration's own model, or nothing, is no override", () => {
  expect(overrideModelConfigured(sonnet)).toBe("sonnet");
  expect(overrideModelChosen({}, sonnet, "sonnet")).toStrictEqual({});
  expect(overrideModelChosen({}, sonnet, "")).toStrictEqual({});
  const typed = overrideModelChosen({}, sonnet, "opus");
  expect(overrideModelChosen(typed, sonnet, "sonnet")).toStrictEqual({});
  expect(overrideModelConfigured(basic)).toBeUndefined();
  expect(overrideModelChosen(typed, basic, "")).toStrictEqual({});
});

test("a box typed with the configuration's own model still says what the form holds", () => {
  expect(overrideModelSays({}, sonnet, "sonnet")).toBe(true);
  expect(overrideModelSays({}, sonnet, "opus")).toBe(false);
});

test("a worker that predates modes draws no model, and typing one changes nothing", () => {
  const bare = { worker: { arguments: ["--model=opus"] } };
  expect(overrideModelDrawn(bare)).toBe(false);
  expect(overrideModelChosen({}, bare, "sonnet")).toStrictEqual({});
  expect(overrideModelDrawn(sonnet)).toBe(true);
});

test("a mode is overridden as its document writes it, a field nothing here reads included", () => {
  const unread = {
    worker: { mode: { ...(modeOf(codex) as object), effort: "high" } },
  };
  expect(overrideModelChosen({}, unread, "o3")).toStrictEqual({
    "worker.mode": { ...(modeOf(unread) as object), model: "o3" },
  });
});

test("a form with nothing overridden sends no overrides", () => {
  const body = creationBodyFrom(creationOffers, creationForm(), []);
  expect(body.assembled === "Body" && "overrides" in body.body).toBe(false);
});

test("a model typed is sent as the mode, nested under the configuration's own names", () => {
  const overrides = overrideModelChosen({}, sonnet, "opus");
  const body = creationBodyFrom(
    creationOffers,
    creationForm({ overrides }),
    [],
  );
  expect(body.assembled === "Body" && body.body.overrides).toStrictEqual({
    worker: { mode: overrides["worker.mode"] },
  });
});

test("a field given back to the configuration sends no override for it", () => {
  const held = overrideHeld(
    overrideHeld({}, "worker.setup", ["npm ci"]),
    "practices",
    ["RegressionCoverage"],
  );
  const given = overrideHeld(held, "worker.setup", undefined);
  const body = creationBodyFrom(
    creationOffers,
    creationForm({ overrides: given }),
    [],
  );
  expect(body.assembled === "Body" && body.body.overrides).toStrictEqual({
    practices: ["RegressionCoverage"],
  });
  const none = creationBodyFrom(
    creationOffers,
    creationForm({ overrides: overrideHeld(given, "practices", undefined) }),
    [],
  );
  expect(none.assembled === "Body" && "overrides" in none.body).toBe(false);
});

test("lines are sent without the empty ones a box leaves", () => {
  const body = creationBodyFrom(
    creationOffers,
    creationForm({
      overrides: { "work.instructions": ["Do it.", "", "Then stop.", ""] },
    }),
    [],
  );
  expect(body.assembled === "Body" && body.body.overrides).toStrictEqual({
    work: { instructions: ["Do it.", "Then stop."] },
  });
});

test("a mode the contract refuses is a fault at the model, before submit", () => {
  const unread = {
    worker: { mode: { ...(modeOf(codex) as object), effort: "high" } },
  };
  const body = creationBodyFrom(
    creationOffers,
    creationForm({ overrides: overrideModelChosen({}, unread, "o3") }),
    [],
  );
  expect(body.assembled === "Faults" && body.faults).toStrictEqual([
    {
      field: "overrides",
      override: "worker.mode",
      reason:
        "Model: this model is written into a mode a ticket may not override with",
    },
  ]);
});

test("choosing another configuration keeps what was overridden", () => {
  const offers = [
    creationOffer(creationSummary("r3", "Ready")),
    creationOffer(creationSummary("r4", "Ready")),
  ];
  const overrides = overrideModelChosen(
    overrideHeld({}, "worker.setup", ["make"]),
    sonnet,
    "opus",
  );
  const chosen = creationConfigurationChosen(
    creationForm({ configuration: "r3", overrides }),
    offers,
    "r4",
  );
  expect(chosen.overrides).toStrictEqual(overrides);
});

test("a ticket's overrides read back into the form they were sent from", () => {
  const overrides = overrideModelChosen(
    overrideHeld({}, "brief.constraints", ["Touch nothing else."]),
    sonnet,
    "opus",
  );
  const body = creationBodyFrom(
    creationOffers,
    creationForm({ overrides }),
    [],
  );
  expect(
    overridesHeldOf(
      body.assembled === "Body" ? body.body.overrides : undefined,
    ),
  ).toStrictEqual(overrides);
});
