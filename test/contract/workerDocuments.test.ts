/**
 * The contract's worker document schemas held to the parsers that decide the
 * same documents. Whatever a parser accepts, its schema accepts; read from the
 * other side, that is whatever a schema refuses, its parser refuses. The
 * parser may refuse more — a path's normal form, an identity's brand, one field
 * against another — so nothing here asks the two to agree exactly.
 *
 * THE CASES ARE THE PARSERS' OWN SUITES' BODIES, and bodies built from each
 * schema at and one past every bound it states. A manifest body written at a
 * retained version is lifted to the version the harness writes, which is the
 * only one the schema describes.
 *
 * EACH RELEASE REPLAYED ON A PLANE WRITES DOCUMENTS THIS TREE READS. Each
 * example written at that release's version that its schema accepts is offered
 * again with every value of each roster the schema names. Lifted to the version
 * the harness writes, every one is accepted by this tree's schema. The reader
 * reads every example built from what the harness writes and each value in some
 * example, and refuses none whose example it reads but for the refusals this
 * suite names as allowed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { z, type ZodType } from "zod";

import { resultReportCharsMax } from "../../src/contract/http.ts";
import { resultVerdicts } from "../../src/contract/rosters.ts";
import * as contract from "../../src/contract/workerDocuments.ts";
import * as reader from "../../src/interpreter/resultManifest.ts";
import {
  accept,
  digestFor,
  manifestBodiesMistyped,
  manifestBodiesRefused,
  report,
  row,
  source,
  sourceReport,
  workerReport,
} from "../interpreter/resultManifestFixture.ts";
import {
  workerContractEnumsSeen,
  workerContractEnumsWalked,
  workerContractOptionalsSeen,
  workerContractReleaseExport,
  workerContractReleaseSchema,
  workerContractReplayed,
  type WorkerContractPlane,
} from "./workerContractReleases.ts";

/** One body and what each side answered it. */
interface Judged {
  readonly text: string;
  readonly parser: boolean;
  readonly schema: boolean;
}

/** An example built from a schema: what it varies, the value, and whether the schema was built to accept it. */
type Built = readonly [string, Readonly<Record<string, unknown>>, boolean];

/** Whether the text parses as JSON, which is what a schema is handed. */
function textIsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether the text is JSON the schema accepts, which is a schema's answer to a body. */
function schemaAccepts(schema: ZodType, text: string): boolean {
  return textIsJson(text) && schema.safeParse(JSON.parse(text)).success;
}

/**
 * Asserts no body is accepted by the parser and refused by the schema, over
 * cases that reach both answers. A refusal counts only where the text is JSON,
 * since text that is not JSON is refused before any schema is asked.
 */
function assertParserAcceptsNothingSchemaRefuses(
  judged: readonly Judged[],
): void {
  assert.ok(
    judged.some((each) => each.parser),
    "no case the parser accepts, so nothing is held on that side",
  );
  assert.ok(
    judged.some((each) => !each.schema && textIsJson(each.text)),
    "no JSON case the schema refuses, so nothing is held on that side",
  );
  assert.deepEqual(
    judged
      .filter((each) => each.parser && !each.schema)
      .map((each) => each.text.slice(0, 200)),
    [],
  );
}

/** The names of the built examples the schema answers otherwise than it was built to. */
function builtMisjudged(schema: ZodType, built: readonly Built[]): string[] {
  return built
    .filter(([, value, accepts]) => schema.safeParse(value).success !== accepts)
    .map(([what]) => what);
}

/** A value at a bound the schema states and one past it, built to be accepted and refused in turn. */
function builtAtBound(
  what: string,
  bound: number,
  valueOf: (size: number) => Readonly<Record<string, unknown>>,
): Built[] {
  return [
    [`${what} at the bound`, valueOf(bound), true],
    [`${what} past it`, valueOf(bound + 1), false],
  ];
}

/** A manifest body at a retained version, rewritten at the one the harness writes; any other text is unchanged. */
function manifestLifted(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return text;
  const record = value as Record<string, unknown>;
  const version = record["version"];
  if (
    version === contract.resultManifestSchemaVersion ||
    !contract.resultManifestSchemaVersionsAccepted.some(
      (retained) => retained === version,
    )
  )
    return text;
  return JSON.stringify({
    report: "a review",
    ...record,
    version: contract.resultManifestSchemaVersion,
  });
}

/** The bodies the reader's own suite reads, beyond the one per rejection its fixture keeps. */
function manifestBodiesFromReaderSuite(): readonly string[] {
  const handoffs = Array.from({ length: reader.manifestHandoffsMax }, (_, at) =>
    row(`out/${String(at)}`),
  );
  const digest = digestFor("out/a");
  return [
    ...manifestBodiesRefused(),
    ...manifestBodiesMistyped.map(([text]) => text),
    workerReport("Pass"),
    workerReport("Fail"),
    workerReport("Fail", null),
    report("Pass", []),
    '{"version":1,"verdict":"Pass"}',
    sourceReport("Pass", source),
    sourceReport("Fail", null),
    sourceReport("Pass", { ...source, extra: "ignored" }),
    sourceReport("Pass", { ...source, base: "c".repeat(39) }),
    report("Pass", handoffs),
    report("Fail", [], [row("log/a")]),
    report("Pass", [row("out/a", 0)]),
    report("Pass", [row("out/a", 1.5)]),
    report("Pass", [row("out/a", Number.MAX_VALUE)]),
    ...[`sha256:${digest}`, digest.slice(0, 63), `${digest}0`].map(
      (malformed) =>
        report("Pass", [{ path: "out/a", digest: malformed, bytes: 1 }]),
    ),
    report("Pass", [
      row(`out/e${String.fromCharCode(0x301)}`.normalize("NFC")),
    ]),
    report("Pass", [row("out/a"), row("out/b")]),
    report("Pass", [row("out/a")], [row("out/b")]),
    report("Pass", [row("out/a")], [row("OUT/A")]),
    JSON.stringify({
      version: 1,
      verdict: "Pass",
      handoffs: {},
      diagnostics: [],
    }),
    JSON.stringify({
      version: 1,
      verdict: "Pass",
      handoffs: [{ path: 1, digest, bytes: 1 }],
      diagnostics: [],
    }),
  ];
}

/** A path of exactly this many code points that the reader's own segment rules admit. */
function artifactPathOfChars(chars: number): string {
  const segment = "a".repeat(reader.artifactPathSegmentCharsMax);
  return Array.from({ length: reader.artifactPathSegmentsMax }, () => segment)
    .join("/")
    .slice(0, chars);
}

/** What the harness writes, which every manifest example varies one thing of. */
const manifestWritten = JSON.parse(workerReport("Pass")) as Readonly<
  Record<string, unknown>
>;

function manifestWith(
  changes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { ...manifestWritten, ...changes };
}

function manifestWithout(key: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(manifestWritten).filter(([found]) => found !== key),
  );
}

function manifestArtifacts(count: number, prefix: string): unknown[] {
  return Array.from({ length: count }, (_, at) =>
    row(`${prefix}/${String(at)}`),
  );
}

function manifestArtifact(
  artifact: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return manifestWith({ diagnostics: [artifact] });
}

const manifestDigest = digestFor("log/a");

/** Examples of the manifest's own keys, at and past each bound the schema states for them. */
const manifestBuiltEnvelope: readonly Built[] = [
  ["as the harness writes it", manifestWritten, true],
  ...resultVerdicts.map((verdict): Built => [
    verdict,
    manifestWith({ verdict }),
    true,
  ]),
  ["an unknown verdict", manifestWith({ verdict: "Skip" }), false],
  [
    "the next version",
    manifestWith({ version: contract.resultManifestSchemaVersion + 1 }),
    false,
  ],
  ...builtAtBound("a report", resultReportCharsMax, (chars) =>
    manifestWith({ report: "😀".repeat(chars) }),
  ),
  ["an empty report", manifestWith({ report: "" }), false],
  ...builtAtBound("handoffs", contract.manifestHandoffsMax, (count) =>
    manifestWith({ handoffs: manifestArtifacts(count, "out") }),
  ),
  ...builtAtBound("diagnostics", contract.manifestDiagnosticsMax, (count) =>
    manifestWith({ diagnostics: manifestArtifacts(count, "log") }),
  ),
  ["an unknown key", manifestWith({ extra: 1 }), false],
  ...["version", "verdict", "report", "handoffs", "diagnostics"].map(
    (key): Built => [`no ${key}`, manifestWithout(key), false],
  ),
];

/** Examples of the source handoff, which the schema reads only as four strings. */
const manifestBuiltSource: readonly Built[] = [
  ["a source", manifestWith({ source }), true],
  ["a null source", manifestWith({ source: null }), true],
  [
    "a source with an unknown key",
    manifestWith({ source: { ...source, extra: "x" } }),
    false,
  ],
  [
    "a source missing a key",
    manifestWith({
      source: {
        repository: source.repository,
        ref: source.ref,
        commit: source.commit,
      },
    }),
    false,
  ],
  [
    "a source naming a number",
    manifestWith({ source: { ...source, commit: 1 } }),
    false,
  ],
];

/** Examples of the evaluated tree, which is a git object id in either width and is left out where none was evaluated. */
const manifestBuiltTree: readonly Built[] = [
  ["a tree", manifestWith({ evaluatedTree: "a".repeat(40) }), true],
  ["a wide tree", manifestWith({ evaluatedTree: "a".repeat(64) }), true],
  ["a tree one short", manifestWith({ evaluatedTree: "a".repeat(39) }), false],
  [
    "a tree of a width between",
    manifestWith({ evaluatedTree: "a".repeat(41) }),
    false,
  ],
  [
    "an upper-case tree",
    manifestWith({ evaluatedTree: "A".repeat(40) }),
    false,
  ],
  ["a null tree", manifestWith({ evaluatedTree: null }), false],
  ["a tree naming a number", manifestWith({ evaluatedTree: 1 }), false],
];

/** Examples of one artifact row, at and past each bound the schema states for it. */
const manifestBuiltArtifacts: readonly Built[] = [
  ...builtAtBound("a path", contract.artifactPathCharsMax, (chars) =>
    manifestArtifact(row(artifactPathOfChars(chars))),
  ),
  ["an empty path", manifestArtifact(row("")), false],
  [
    "a digest one short",
    manifestArtifact({ ...row("log/a"), digest: manifestDigest.slice(1) }),
    false,
  ],
  [
    "a digest one long",
    manifestArtifact({ ...row("log/a"), digest: `${manifestDigest}0` }),
    false,
  ],
  [
    "an upper-case digest",
    manifestArtifact({ ...row("log/a"), digest: manifestDigest.toUpperCase() }),
    false,
  ],
  ["no bytes", manifestArtifact(row("log/a", 0)), true],
  ...builtAtBound("bytes", contract.artifactBytesMax, (bytes) =>
    manifestArtifact(row("log/a", bytes)),
  ),
  ["negative bytes", manifestArtifact(row("log/a", -1)), false],
  ["fractional bytes", manifestArtifact(row("log/a", 0.5)), false],
  ["bytes as text", manifestArtifact({ ...row("log/a"), bytes: "1" }), false],
  [
    "an artifact with an unknown key",
    manifestArtifact({ ...row("log/a"), extra: 1 }),
    false,
  ],
  [
    "an artifact with no digest",
    manifestArtifact({ path: "log/a", bytes: 1 }),
    false,
  ],
];

const manifestBuilt: readonly Built[] = [
  ...manifestBuiltEnvelope,
  ...manifestBuiltSource,
  ...manifestBuiltTree,
  ...manifestBuiltArtifacts,
];

test("every bound the manifest schema copies is the reader's own", () => {
  assert.deepEqual(
    {
      artifactPathCharsMax: contract.artifactPathCharsMax,
      artifactBytesMax: contract.artifactBytesMax,
      manifestHandoffsMax: contract.manifestHandoffsMax,
      manifestDiagnosticsMax: contract.manifestDiagnosticsMax,
    },
    {
      artifactPathCharsMax: reader.artifactPathCharsMax,
      artifactBytesMax: reader.artifactBytesMax,
      manifestHandoffsMax: reader.manifestHandoffsMax,
      manifestDiagnosticsMax: reader.manifestDiagnosticsMax,
    },
  );
});

test("every manifest example is answered by the schema as it was built to be", () => {
  assert.deepEqual(
    builtMisjudged(contract.resultManifestDocumentSchema, manifestBuilt),
    [],
  );
});

test("the reader accepts no manifest the schema refuses", () => {
  const texts = [
    ...manifestBodiesFromReaderSuite(),
    ...manifestBuilt.map(([, value]) => JSON.stringify(value)),
  ].map(manifestLifted);
  assertParserAcceptsNothingSchemaRefuses(
    texts.map((text) => ({
      text,
      parser: accept(text).accepted === "Accepted",
      schema: schemaAccepts(contract.resultManifestDocumentSchema, text),
    })),
  );
});

/** The code the reader refuses the manifest with, or nothing where it reads it. */
function manifestParserRefusal(text: string): string | undefined {
  const answer = accept(text);
  return answer.accepted === "Accepted" ? undefined : answer.code;
}

/**
 * The refusals a manifest whose example the reader reads may meet once a roster
 * value in it is walked: a failed verdict carrying handoffs or a source. Adding
 * one decides that a manifest an older release's schema admits may be refused.
 */
const manifestWalkedRefusalsAllowed: readonly reader.ManifestRejection[] = [
  "HandoffsOnFailedVerdict",
  "SourceOnFailedVerdict",
];

/**
 * An example's text, the reader's refusal of a text under the view the example
 * is read against, and whether the example was built from what the harness
 * writes. Only a built one must be read, since the reader suite that owns each
 * of the others judges it.
 */
type Example = readonly [string, (text: string) => string | undefined, boolean];

/** A document a harness writes: the plane it is written on, the names a release exports it under, how this tree reads it, and the refusals a walk may meet. */
interface Replayed {
  readonly plane: WorkerContractPlane;
  readonly version: string;
  readonly accepted: readonly number[];
  readonly name: string;
  readonly schema: ZodType;
  readonly lifted: (text: string) => string;
  readonly examples: readonly Example[];
  readonly refusalsAllowed: readonly string[];
}

const replayed: readonly Replayed[] = [
  {
    plane: "job",
    version: "resultManifestSchemaVersion",
    accepted: contract.resultManifestSchemaVersionsAccepted,
    name: "resultManifestDocumentSchema",
    schema: contract.resultManifestDocumentSchema,
    lifted: manifestLifted,
    examples: [
      ...manifestBodiesFromReaderSuite().map((text): Example => [
        text,
        manifestParserRefusal,
        false,
      ]),
      ...manifestBuilt.map(([, value]): Example => [
        JSON.stringify(value),
        manifestParserRefusal,
        true,
      ]),
    ],
    refusalsAllowed: manifestWalkedRefusalsAllowed,
  },
];

/** Each example that is a JSON object, written at `version`, where `older` accepts it there. */
function replayExamples(
  older: ZodType,
  version: number,
  examples: readonly Example[],
): readonly (readonly [unknown, Example[1], Example[2]])[] {
  return examples.flatMap(([text, refusal, built]) => {
    const value: unknown = textIsJson(text) ? JSON.parse(text) : undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return [];
    const example = { ...value, version };
    return older.safeParse(example).success
      ? [[example, refusal, built] as const]
      : [];
  });
}

/** Each roster value offered under a path that no example the reader accepts holds there. */
function replayUnread(
  offered: ReadonlyMap<string, ReadonlySet<unknown>>,
  read: ReadonlyMap<string, ReadonlySet<unknown>>,
): string[] {
  return [...offered].flatMap(([path, values]) =>
    [...values]
      .filter((value) => read.get(path)?.has(value) !== true)
      .map((value) => `${path}=${String(value)}`),
  );
}

for (const document of replayed)
  for (const release of workerContractReplayed(document.plane))
    test(`a ${release} harness writes its ${document.name} at a version this tree reads, and this tree takes it with every roster value that release names`, async () => {
      const written = await workerContractReleaseExport(
        release,
        "workerDocuments",
        document.version,
        z.number(),
      );
      assert.ok(document.accepted.some((known) => known === written));
      const older = await workerContractReleaseExport(
        release,
        "workerDocuments",
        document.name,
        workerContractReleaseSchema,
      );
      const examples = replayExamples(older, written, document.examples);
      assert.ok(examples.length > 0, `${release} writes no example offered`);
      const optionals = new Map<string, Set<boolean>>();
      const offered = new Map<string, Set<unknown>>();
      const read = new Map<string, Set<unknown>>();
      for (const [example, refusal, built] of examples) {
        workerContractOptionalsSeen(older, example, document.name, optionals);
        const exampleRefused = refusal(JSON.stringify(example));
        assert.ok(
          !built || exampleRefused === undefined,
          `the reader refuses what the harness writes, ${JSON.stringify(example).slice(0, 200)}: ${String(exampleRefused)}`,
        );
        const exampleRead = exampleRefused === undefined;
        for (const walked of workerContractEnumsWalked(older, example)) {
          const text = JSON.stringify(walked);
          assert.ok(older.safeParse(walked).success, text.slice(0, 200));
          assert.ok(
            schemaAccepts(document.schema, document.lifted(text)),
            `this tree's ${document.name} refuses ${text.slice(0, 200)}`,
          );
          workerContractEnumsSeen(older, walked, document.name, offered);
          const refused = refusal(text);
          if (refused === undefined)
            workerContractEnumsSeen(older, walked, document.name, read);
          else
            assert.ok(
              !exampleRead || document.refusalsAllowed.includes(refused),
              `the reader refuses ${text.slice(0, 200)}: ${refused}`,
            );
        }
      }
      assert.deepEqual(
        [...optionals].filter(([, held]) => held.size !== 2),
        [],
        "every optional field is both present and left out among the examples",
      );
      assert.deepEqual(replayUnread(offered, read), []);
    });
