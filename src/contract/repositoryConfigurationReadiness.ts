/**
 * Whether the files a repository's `.chug/configurations/` holds import, judged
 * before anything is stored and wherever the files were read from: at a
 * commit by the import, or in a working tree by the setup program before the
 * tree is committed. Both call this, so a tree the program passes is one the
 * import takes.
 *
 * A FILE IS JUDGED WHOLE AND THE TREE ALL OR NOTHING. Each file is its
 * envelope, then the configuration it declares with every file it names stored
 * inline, then that configuration's canonical encoding, then its readiness; a
 * file refused at any of those is one refusal, and one refusal refuses the
 * tree.
 *
 * READINESS HERE IS A CONFIGURATION'S OWN, paired with no brief: whatever a
 * ticket's brief later asks of it is the release's to judge.
 */

import type { z } from "zod";

import {
  configurationDocumentSchema,
  declaredConfigurationSchema,
  repositoryConfigurationNameSchema,
  repositoryConfigurationRoot,
} from "./configurationDocument.ts";
import { executionRequirementConfigurationIsValid } from "./executionRequirement.ts";
import { configurationCanonicalCharsMax, textWellFormed } from "./http.ts";
import {
  repositoryConfigurationReferences,
  repositoryConfigurationReferencesMax,
  repositoryConfigurationResolved,
  type RepositoryConfigurationReferenced,
} from "./repositoryConfigurationReference.ts";
import {
  isRepositoryDeclarationPath,
  repositoryDeclarationContent,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "./repositoryDeclaration.ts";
import type { RepositoryConfigurationFault } from "./rosters.ts";
import {
  authoredTaskConfigurationReadiness,
  briefsAnyAgent,
  type AuthoredTaskConfiguration,
  type TaskConfigurationFault,
} from "./taskConfiguration.ts";
import {
  declaredConfigurationIsCatalog,
  workloadConfigurationReadiness,
  type WorkloadConfiguration,
  type WorkloadConfigurationFault,
} from "./workloadConfiguration.ts";

/** A ready version 1 configuration: one document whose stages are its blocks. */
export type ReleaseConfiguration = Readonly<Record<string, unknown>> & {
  readonly version: 1;
  readonly image: string;
} & AuthoredTaskConfiguration;

/** A ready configuration of either version, told apart by its own `version`. */
export type DeclaredConfiguration =
  ReleaseConfiguration | WorkloadConfiguration;

/** Why one configuration is not ready, before any brief is paired with it. */
export type DeclaredConfigurationFault =
  | "ReleaseShapeInvalid"
  | "WorkerUndeclared"
  | TaskConfigurationFault
  | WorkloadConfigurationFault;

export type DeclaredConfigurationReadiness<Configuration> =
  | { readonly readiness: "Ready"; readonly configuration: Configuration }
  | {
      readonly readiness: "Incomplete";
      readonly fault: DeclaredConfigurationFault;
    };

/** Whether a version 1 document is ready: its shape, where it runs, and a worker declared wherever an agent is briefed. */
export function releaseDocumentConfigurationReadiness(
  value: unknown,
): DeclaredConfigurationReadiness<ReleaseConfiguration> {
  const authored = authoredTaskConfigurationReadiness(value);
  if (!executionRequirementConfigurationIsValid(value))
    return { readiness: "Incomplete", fault: "ReleaseShapeInvalid" };
  if (authored.readiness === "Incomplete") return authored;
  if (
    authored.configuration.worker === undefined &&
    briefsAnyAgent(authored.configuration)
  )
    return { readiness: "Incomplete", fault: "WorkerUndeclared" };
  return { readiness: "Ready", configuration: value as ReleaseConfiguration };
}

/** Whether one parsed configuration of either version is ready, by its own version. */
export function declaredConfigurationReadiness(
  value: unknown,
): DeclaredConfigurationReadiness<DeclaredConfiguration> {
  return declaredConfigurationIsCatalog(value)
    ? workloadConfigurationReadiness(value)
    : releaseDocumentConfigurationReadiness(value);
}

const prohibitedConfigurationKeys =
  /(?:password|secret|token|credential(?!s$))/iu;

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object")
    throw new TypeError("canonical configuration: unsupported JSON value");
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (prohibitedConfigurationKeys.test(key))
      throw new RangeError(
        `canonical configuration: prohibited secret-bearing field ${key}`,
      );
    result[key] = canonicalValue(record[key]);
  }
  return result;
}

/** One parsed configuration as JSON with its keys sorted and no whitespace, refusing what no configuration may hold. */
export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalValue(value));
  if (encoded === undefined)
    throw new TypeError("canonical configuration: value is not JSON");
  return encoded;
}

/**
 * A file refused, the file it names by reference where that is what was
 * refused, and a `ConfigurationTooLong` configuration's canonical length
 * against the longest one may be.
 */
export interface RepositoryConfigurationRefusal {
  readonly path: string;
  readonly fault: RepositoryConfigurationFault;
  readonly configurationFault?: DeclaredConfigurationFault;
  readonly reference?: string;
  readonly chars?: number;
  readonly charsMax?: number;
}

/**
 * One refusal, and the fields of the file it is about, each a dotted path from
 * the file's top: the envelope's where the envelope is refused, and where the
 * configuration's shape is, each the schema refused. None where the fault
 * names no field.
 */
export interface RepositoryConfigurationFileRefused {
  readonly refusal: RepositoryConfigurationRefusal;
  readonly fields: readonly string[];
}

/** One file ready to store: its name, its configuration canonically encoded and ready, and the file each workload named by path was read from. */
export interface RepositoryConfigurationFileReady {
  readonly name: string;
  readonly path: string;
  readonly canonical: string;
  readonly configuration: DeclaredConfiguration;
  readonly workloadPaths: Readonly<Record<string, string>>;
}

export type RepositoryConfigurationFilesReadiness =
  | {
      readonly readiness: "Ready";
      readonly declarations: readonly RepositoryConfigurationFileReady[];
    }
  | {
      readonly readiness: "Refused";
      readonly faults: readonly RepositoryConfigurationFileRefused[];
    };

/** Every field an envelope holds, which is every field it may. */
const repositoryConfigurationFields = Object.keys(
  configurationDocumentSchema.shape,
).sort();

/** `value` as an object's fields, or nothing where it is no object. */
function repositoryConfigurationRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The configuration a declaration file holds where it holds an envelope, read for the files it names. */
function repositoryConfigurationDeclared(
  file: RepositoryDeclarationFile,
): unknown {
  const content = repositoryDeclarationContent(file);
  if (content.content === "Refused") return undefined;
  return repositoryConfigurationRecord(content.document)?.["configuration"];
}

/** Every distinct path the files' configurations name, given the files read so far. */
export function repositoryConfigurationImportReferences(
  files: readonly RepositoryDeclarationFile[],
  referenced: ReadonlyMap<string, RepositoryConfigurationReferenced>,
): readonly string[] {
  return [
    ...new Set(
      files.flatMap((file) =>
        repositoryConfigurationReferences(
          repositoryConfigurationDeclared(file),
          referenced,
        ),
      ),
    ),
  ];
}

/** What reading the files a catalog names came to: each as found, or what stopped the read, which is the reader's own. */
export type RepositoryConfigurationReferencesRead<Stopped> =
  | {
      readonly read: "Referenced";
      readonly files: readonly RepositoryConfigurationReferenced[];
    }
  | Stopped;

/**
 * Every file the declarations name, read until what they name is read. Each
 * round reads at least one path not yet read, so one more round than an
 * import reads paths is as many as it can take, and declarations naming more
 * than that stop reading for readiness to refuse. A path `read` does not
 * answer is absent.
 */
export async function repositoryConfigurationReferencedRead<Stopped>(
  files: readonly RepositoryDeclarationFile[],
  read: (
    paths: readonly string[],
  ) => Promise<RepositoryConfigurationReferencesRead<Stopped>>,
): Promise<
  | {
      readonly read: "Referenced";
      readonly referenced: ReadonlyMap<
        string,
        RepositoryConfigurationReferenced
      >;
    }
  | { readonly read: "Stopped"; readonly stopped: Stopped }
> {
  const referenced = new Map<string, RepositoryConfigurationReferenced>();
  for (let round = 0; round <= repositoryConfigurationReferencesMax; round++) {
    const named = repositoryConfigurationImportReferences(files, referenced);
    const unread = named.filter((path) => !referenced.has(path));
    if (
      named.length > repositoryConfigurationReferencesMax ||
      unread.length === 0
    )
      break;
    const answer = await read(unread);
    if (!repositoryConfigurationReferencesAnswered(answer))
      return { read: "Stopped", stopped: answer };
    for (const file of answer.files)
      if (unread.includes(file.path)) referenced.set(file.path, file);
    for (const path of unread)
      if (!referenced.has(path))
        referenced.set(path, { path, found: "Absent" });
  }
  return { read: "Referenced", referenced };
}

function repositoryConfigurationReferencesAnswered<Stopped>(
  answer: RepositoryConfigurationReferencesRead<Stopped>,
): answer is {
  readonly read: "Referenced";
  readonly files: readonly RepositoryConfigurationReferenced[];
} {
  const record = repositoryConfigurationRecord(answer);
  return record?.["read"] === "Referenced" && Array.isArray(record["files"]);
}

/** Whether a declared configuration asks a person's approval at landing rather than in a plan. */
function repositoryConfigurationAsksLandingApproval(
  configuration: unknown,
): boolean {
  const fields = repositoryConfigurationRecord(configuration);
  if (fields === undefined) return false;
  if (!declaredConfigurationIsCatalog(fields))
    return Object.hasOwn(fields, "finalizationApprovalRequired");
  const finalizers = repositoryConfigurationRecord(fields["finalizers"]);
  return Object.values(finalizers ?? {}).some((finalizer) => {
    const named = repositoryConfigurationRecord(finalizer);
    return named !== undefined && Object.hasOwn(named, "approvalRequired");
  });
}

/** The envelope's fields that are not as they must be: each one it lacks or should not hold, and its version where that is not the one this tree reads. */
function repositoryConfigurationEnvelopeFaults(
  record: Readonly<Record<string, unknown>>,
): readonly string[] {
  const held = Object.keys(record);
  const wrong = [
    ...repositoryConfigurationFields.filter((field) => !held.includes(field)),
    ...held.filter((field) => !repositoryConfigurationFields.includes(field)),
  ];
  if (
    held.includes("version") &&
    !configurationDocumentSchema.shape.version.safeParse(record["version"])
      .success
  )
    wrong.push("version");
  return wrong.sort();
}

/** An issue's path as a field of the file: dotted from the envelope's top. */
function repositoryConfigurationIssueField(issue: z.core.$ZodIssue): string {
  return ["configuration", ...issue.path.map(String)].join(".");
}

/** The fields of a configuration the schema refuses, each once, in the order it found them. */
function repositoryConfigurationShapeFields(
  configuration: unknown,
): readonly string[] {
  const parsed = declaredConfigurationSchema.safeParse(configuration);
  return parsed.success
    ? []
    : [...new Set(parsed.error.issues.map(repositoryConfigurationIssueField))];
}

function repositoryConfigurationFileRefusal(
  refusal: RepositoryConfigurationRefusal,
  fields: readonly string[] = [],
): RepositoryConfigurationFileRefused {
  return { refusal, fields };
}

/** One file's configuration, its references stored inline, canonically encoded and judged ready. */
function repositoryConfigurationFileResolved(
  path: string,
  name: string,
  configuration: unknown,
  referenced: ReadonlyMap<string, RepositoryConfigurationReferenced>,
): RepositoryConfigurationFileReady | RepositoryConfigurationFileRefused {
  const resolved = repositoryConfigurationResolved(configuration, referenced);
  if ("fault" in resolved)
    return repositoryConfigurationFileRefusal({
      path,
      fault: resolved.fault,
      reference: resolved.reference,
    });
  let canonical: string;
  try {
    canonical = canonicalJson(resolved.configuration);
  } catch {
    return repositoryConfigurationFileRefusal({
      path,
      fault: "ConfigurationInvalid",
    });
  }
  // eslint-disable-next-line no-restricted-syntax -- this bound is in UTF-16 code units, as a stored configuration is measured
  if (canonical.length > configurationCanonicalCharsMax)
    return repositoryConfigurationFileRefusal({
      path,
      fault: "ConfigurationTooLong",
      chars: canonical.length,
      charsMax: configurationCanonicalCharsMax,
    });
  if (!textWellFormed(canonical))
    return repositoryConfigurationFileRefusal({
      path,
      fault: "ConfigurationInvalid",
    });
  const readiness = declaredConfigurationReadiness(JSON.parse(canonical));
  if (readiness.readiness === "Incomplete")
    return repositoryConfigurationFileRefusal(
      {
        path,
        fault: "ConfigurationInvalid",
        configurationFault: readiness.fault,
      },
      repositoryConfigurationShapeFields(resolved.configuration),
    );
  return {
    name,
    path,
    canonical,
    configuration: readiness.configuration,
    workloadPaths: resolved.workloadPaths,
  };
}

/** One declaration file judged: ready to store, or the one refusal it earns. */
function repositoryConfigurationFileReadiness(
  file: RepositoryDeclarationFile,
  referenced: ReadonlyMap<string, RepositoryConfigurationReferenced>,
): RepositoryConfigurationFileReady | RepositoryConfigurationFileRefused {
  const path = file.path;
  if (!isRepositoryDeclarationPath(repositoryConfigurationRoot, path))
    return repositoryConfigurationFileRefusal({ path, fault: "PathInvalid" });
  const content = repositoryDeclarationContent(file);
  if (content.content === "Refused")
    return repositoryConfigurationFileRefusal({ path, fault: content.fault });
  const record = repositoryConfigurationRecord(content.document);
  if (record === undefined)
    return repositoryConfigurationFileRefusal({
      path,
      fault: "EnvelopeInvalid",
    });
  const envelope = repositoryConfigurationEnvelopeFaults(record);
  if (envelope.length > 0)
    return repositoryConfigurationFileRefusal(
      { path, fault: "EnvelopeInvalid" },
      envelope,
    );
  const name = record["name"];
  if (!repositoryConfigurationNameSchema.safeParse(name).success)
    return repositoryConfigurationFileRefusal({ path, fault: "NameInvalid" }, [
      "name",
    ]);
  if (repositoryConfigurationAsksLandingApproval(record["configuration"]))
    return repositoryConfigurationFileRefusal({
      path,
      fault: "ApprovalOutsidePlan",
    });
  return repositoryConfigurationFileResolved(
    path,
    name as string,
    record["configuration"],
    referenced,
  );
}

/**
 * Judges one bounded set of declaration files atomically into ready
 * declarations or refusals, with the files their catalogs name as they were
 * read.
 */
export function repositoryConfigurationFilesReadiness(input: {
  readonly files: readonly RepositoryDeclarationFile[];
  readonly referenced?: ReadonlyMap<string, RepositoryConfigurationReferenced>;
}): RepositoryConfigurationFilesReadiness {
  const referenced = input.referenced ?? new Map();
  const whole = (fault: RepositoryConfigurationFault) =>
    ({
      readiness: "Refused",
      faults: [
        repositoryConfigurationFileRefusal({
          path: repositoryConfigurationRoot,
          fault,
        }),
      ],
    }) as const;
  if (input.files.length > repositoryDeclarationsMax)
    return whole("TooManyDeclarations");
  if (
    repositoryConfigurationImportReferences(input.files, referenced).length >
    repositoryConfigurationReferencesMax
  )
    return whole("TooManyReferences");
  const declarations: RepositoryConfigurationFileReady[] = [];
  const faults: RepositoryConfigurationFileRefused[] = [];
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) {
      faults.push(
        repositoryConfigurationFileRefusal({
          path: file.path,
          fault: "DuplicatePath",
        }),
      );
      continue;
    }
    paths.add(file.path);
    const judged = repositoryConfigurationFileReadiness(file, referenced);
    if ("refusal" in judged) {
      faults.push(judged);
      continue;
    }
    if (names.has(judged.name)) {
      faults.push(
        repositoryConfigurationFileRefusal(
          { path: file.path, fault: "DuplicateName" },
          ["name"],
        ),
      );
      continue;
    }
    names.add(judged.name);
    declarations.push(judged);
  }
  return faults.length === 0
    ? { readiness: "Ready", declarations }
    : { readiness: "Refused", faults };
}
