/**
 * The repository's own configuration, from the checkout the setup program is
 * run in: `configuration` writes a starting one, `check` judges what is there
 * as an import of it would, and `import` has the site import it.
 *
 * The starting configuration is a small catalog: work an agent does, the
 * repository's own test command as a check, an agent's review, one plan
 * running both, and defaults naming them. What the program cannot know is
 * left as a field the schema refuses empty, so `check` names each by its
 * field until the person and their agent have filled it in. It is written
 * only where `.chug/configurations/` declares nothing, and never over a file.
 *
 * `check` reads the files the import reads, in the working tree instead of at
 * a commit, and hands them to the judgment the import itself makes, which is
 * the contract's. A tree it passes is one the import takes; what it cannot see
 * is what is not committed and pushed.
 *
 * `import` asks the site to import the repository the checklist means, at the
 * head of its default branch, and then reads the checklist again, so what the
 * import came to is the server's answer and not this program's.
 */

import { repositoryConfigurationRoot } from "../../../../src/contract/configurationDocument.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import { repositoryConfigurationFilesReadiness } from "../../../../src/contract/repositoryConfigurationReadiness.ts";
import type { RepositoryConfigurationFileRefused } from "../../../../src/contract/repositoryConfigurationReadiness.ts";
import { repositoryConfigurationReferencedRead } from "../../../../src/contract/repositoryConfigurationReadiness.ts";
import { repositoryConfigurationRefusalsSchema } from "../../../../src/contract/responses.ts";
import type { RepositoryConfigurationReferenced } from "../../../../src/contract/repositoryConfigurationReference.ts";
import {
  repositoryDeclarationFileCharsMax,
  repositoryDeclarationsMax,
} from "../../../../src/contract/repositoryDeclaration.ts";
import type { RepositoryDeclarationFile } from "../../../../src/contract/repositoryDeclaration.ts";

import type { ApiFailure } from "./apiRequest.ts";
import { apiImportRepositoryConfigurations } from "./apiRoutes.ts";
import type { ApiPorts } from "./apiRequest.ts";
import type {
  SetupBlank,
  SetupCheckEnded,
  SetupCheckFault,
  SetupConfigurationEnded,
  SetupImportAnswered,
} from "./setupConfigurationEnded.ts";
import {
  repositoryImportFault,
  repositoryImportRefusedWord,
} from "./repositoryImport.ts";
import { setupCheckoutTopCommand } from "./setupAgent.ts";
import type { SetupDiskPort, SetupPorts } from "./setupPorts.ts";
import { setupChildBytesMax, setupProbeWaitMs } from "./setupRunnerMachine.ts";
import { setupFlat } from "./setupText.ts";

/** The name the starting configuration is declared under, and the file it is written to. */
export const setupConfigurationName = "development";
export const setupConfigurationPath = `${repositoryConfigurationRoot}${setupConfigurationName}.json`;

/** Each blank by the field `check` names it as. */
export const setupBlankFields: Readonly<Record<SetupBlank, string>> = {
  Image: "configuration.image",
  Test: "configuration.workloads.checks.commands",
};

/** The agent a workload runs as, with no arguments: a job runs its agent with permissions bypassed, where a list of allowed tools restricts nothing. */
const setupWorkerMode = {
  type: "SingleAgent",
  agent: "Claude",
  arguments: [],
} as const;

/** The credential an agent workload runs on, since a workload listing none is granted none. */
const setupAgentAuthority = { credentials: ["claude-code"] } as const;

const setupBuildPrompt =
  "Implement the change this ticket asks for, and nothing else on it. Read the repository's own instructions for agents before changing it, add focused tests for what you change, and run the repository's tests before you report. Report a pass only for work you have seen pass, or a failure naming what stopped you.";

const setupReviewPrompt =
  "Review the change this ticket made, starting from its diff against the base it started from. Read every file it touches in full. Judge whether it is correct, whether it does what the ticket asks, and whether it does anything the ticket did not ask for. Pass it, or fail it naming the file, the line and what is wrong there.";

function setupAgentWorkload(
  prompt: string,
  evaluator: Readonly<Record<string, string>>,
): unknown {
  return {
    runner: "Agent",
    ...evaluator,
    prompt: { text: prompt },
    worker: { mode: setupWorkerMode, setup: [], files: [] },
    authority: setupAgentAuthority,
    framing: "Chuggy",
  };
}

/** The starting configuration, with `test` as its check's one command where the agent said it, and the fields it leaves blank. */
export function setupConfigurationStarting(test: string | undefined): {
  readonly text: string;
  readonly blanks: readonly SetupBlank[];
} {
  const configuration = {
    version: 2,
    image: "",
    workloads: {
      build: setupAgentWorkload(setupBuildPrompt, {}),
      checks: {
        runner: "Commands",
        commands: test === undefined ? [] : [test],
        worker: { setup: [], files: [] },
      },
      review: setupAgentWorkload(setupReviewPrompt, {
        purpose: "Review",
        reevaluate: "OnChange",
      }),
    },
    plans: {
      standard: [
        { name: "checks", evaluators: ["checks"] },
        { name: "review", evaluators: ["review"] },
      ],
    },
    defaults: { work: "build", evaluation: "standard" },
  };
  const envelope = { version: 1, name: setupConfigurationName, configuration };
  return {
    text: `${JSON.stringify(envelope, undefined, 2)}\n`,
    blanks: test === undefined ? ["Image", "Test"] : ["Image"],
  };
}

/** The top of the checkout the folder is in, or nothing where it is in none. */
export async function setupCheckoutTop(
  ports: SetupPorts,
): Promise<string | undefined> {
  const top = (
    await ports.process.read(
      setupCheckoutTopCommand,
      setupProbeWaitMs,
      setupChildBytesMax,
    )
  )?.trim();
  return top !== undefined && top.startsWith("/") && setupFlat(top) === top
    ? top
    : undefined;
}

/** The most bytes a declaration's text takes in UTF-8, which is four for each code point its bound allows. */
const setupDeclarationBytesMax = repositoryDeclarationFileCharsMax * 4;

/** How deep below `.chug/configurations/` the listing looks; the import's listing has no such bound, and refuses any path below the directory itself. */
export const setupDeclarationDepthMax = 8;

/** How many directories below `.chug/configurations/` the listing looks in; one past it is found as `Unlisted`, as one past the depth bound is. */
export const setupDeclarationDirectoriesMax = 64;

/** One path found under the directory an import reads, as the import's listing would hold it, or a directory past the listing's bound, which is refused unread. */
type SetupDeclarationFound =
  | { readonly found: "File"; readonly file: RepositoryDeclarationFile }
  | { readonly found: "TooLarge"; readonly path: string }
  | { readonly found: "Unlisted"; readonly path: string };

/** Whether some directory between the top and `path` is a link, which a commit holds as a file and never as a directory to look in. */
function setupThroughLink(
  disk: SetupDiskPort,
  top: string,
  path: string,
): boolean {
  const segments = path.split("/");
  return segments
    .slice(0, -1)
    .some((_, at) =>
      disk.linked(`${top}/${segments.slice(0, at + 1).join("/")}`),
    );
}

/** One `.json` path under the directory, as the import reads it: a link as a link, and a file by its text where it is not too long to be one. */
function setupDeclarationRead(
  disk: SetupDiskPort,
  top: string,
  path: string,
): SetupDeclarationFound | undefined {
  const whole = `${top}/${path}`;
  if (disk.linked(whole))
    return { found: "File", file: { path, kind: "Symlink", content: "" } };
  if (disk.kind(whole) !== "File") return undefined;
  const content = disk.text(whole, setupDeclarationBytesMax);
  return content === undefined
    ? { found: "TooLarge", path }
    : { found: "File", file: { path, kind: "File", content } };
}

/**
 * Every `.json` path under `.chug/configurations/`, nested ones included, as
 * a commit's recursive listing of it holds them; no more than one past what
 * an import takes, since that one is enough to refuse the directory. A
 * directory that is a link is not looked in, and one past the depth bound or
 * the directory bound is found as `Unlisted` rather than looked in.
 */
function setupDeclarationsListed(
  disk: SetupDiskPort,
  top: string,
): readonly SetupDeclarationFound[] {
  const found: SetupDeclarationFound[] = [];
  const directories: { readonly path: string; readonly depth: number }[] = [
    { path: repositoryConfigurationRoot.slice(0, -1), depth: 0 },
  ];
  if (setupThroughLink(disk, top, `${directories[0]?.path ?? ""}/`))
    return found;
  let queued = 0;
  for (let next = directories.shift(); next !== undefined;) {
    const whole = `${top}/${next.path}`;
    if (!disk.linked(whole) && disk.kind(whole) === "Directory")
      for (const name of [...disk.names(whole)].sort()) {
        const path = `${next.path}/${name}`;
        if (
          disk.kind(`${top}/${path}`) === "Directory" &&
          !disk.linked(`${top}/${path}`)
        ) {
          if (
            next.depth < setupDeclarationDepthMax &&
            queued < setupDeclarationDirectoriesMax
          ) {
            queued += 1;
            directories.push({ path, depth: next.depth + 1 });
          } else found.push({ found: "Unlisted", path: `${path}/` });
          if (found.length > repositoryDeclarationsMax) return found;
          continue;
        }
        if (!name.endsWith(".json")) continue;
        const read = setupDeclarationRead(disk, top, path);
        if (read !== undefined) found.push(read);
        if (found.length > repositoryDeclarationsMax) return found;
      }
    next = directories.shift();
  }
  return found;
}

/** One file a catalog names, read in the working tree as an import reads it at a commit. */
function setupReferencedRead(
  disk: SetupDiskPort,
  top: string,
  path: string,
): RepositoryConfigurationReferenced {
  const whole = `${top}/${path}`;
  if (setupThroughLink(disk, top, path)) return { path, found: "Absent" };
  if (disk.linked(whole)) return { path, found: "Symlink" };
  if (disk.kind(whole) !== "File") return { path, found: "Absent" };
  const content = disk.text(whole, setupDeclarationBytesMax);
  return content === undefined
    ? { path, found: "TooLarge" }
    : { path, found: "File", content };
}

/** Writes the starting configuration into the checkout, where the directory an import reads declares nothing. */
export async function setupConfigurationWritten(
  ports: SetupPorts,
  test: string | undefined,
): Promise<SetupConfigurationEnded> {
  const top = await setupCheckoutTop(ports);
  if (top === undefined) return { ended: "Outside" };
  const held = setupDeclarationsListed(ports.disk, top);
  if (held.length > 0)
    return {
      ended: "Kept",
      paths: held.map((found) =>
        found.found === "File" ? found.file.path : found.path,
      ),
    };
  const starting = setupConfigurationStarting(test);
  ports.disk.make(`${top}/${setupConfigurationPath}`, starting.text);
  return {
    ended: "Written",
    path: setupConfigurationPath,
    blanks: starting.blanks.map((blank) => ({
      blank,
      field: setupBlankFields[blank],
    })),
  };
}

/** How many faults a check prints, and how many fields of each. */
export const setupCheckFaultsMax = 20;
export const setupCheckFieldsMax = 8;

function setupCheckFaultOf(
  refused: RepositoryConfigurationFileRefused,
): SetupCheckFault {
  const { refusal, fields } = refused;
  return {
    path: refusal.path,
    fault: repositoryImportFault(refusal),
    detail: refusal.configurationFault,
    fields: fields.slice(0, setupCheckFieldsMax),
  };
}

function setupCheckRefused(
  faults: readonly RepositoryConfigurationFileRefused[],
): SetupCheckEnded {
  return {
    ended: "Refused",
    faults: faults.slice(0, setupCheckFaultsMax).map(setupCheckFaultOf),
    count: faults.length,
  };
}

/** Judges the checkout's configuration directory, and every file its catalogs name, as an import of it would. */
export async function setupConfigurationChecked(
  ports: SetupPorts,
): Promise<SetupCheckEnded> {
  const top = await setupCheckoutTop(ports);
  if (top === undefined) return { ended: "Outside" };
  const found = setupDeclarationsListed(ports.disk, top);
  if (found.length === 0)
    return { ended: "Absent", directory: repositoryConfigurationRoot };
  const files = found.flatMap((held) =>
    held.found === "File" ? [held.file] : [],
  );
  const unread = found.flatMap((held): RepositoryConfigurationFileRefused[] =>
    held.found === "TooLarge"
      ? [{ refusal: { path: held.path, fault: "ContentTooLarge" }, fields: [] }]
      : held.found === "Unlisted"
        ? [{ refusal: { path: held.path, fault: "PathInvalid" }, fields: [] }]
        : [],
  );
  const read = await repositoryConfigurationReferencedRead<never>(
    files,
    (paths) =>
      Promise.resolve({
        read: "Referenced",
        files: paths.map((path) => setupReferencedRead(ports.disk, top, path)),
      }),
  );
  const referenced = read.read === "Referenced" ? read.referenced : new Map();
  const readiness = repositoryConfigurationFilesReadiness({
    files,
    referenced,
  });
  if (readiness.readiness === "Refused" || unread.length > 0)
    return setupCheckRefused([
      ...unread,
      ...(readiness.readiness === "Refused" ? readiness.faults : []),
    ]);
  return {
    ended: "Clean",
    paths: readiness.declarations.map((declaration) => declaration.path),
  };
}

/** The one write `import` makes for a project: the import of one of its repositories at its head. */
export function setupImportWrites(
  partition: PartitionIdentity,
): readonly string[] {
  const route = nativeHttpRoutes.configurationImports
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project));
  return [`POST ${route}`];
}

/** Each file a refused import names in its answer, as `check` says one; the site names no field. */
function setupImportFaults(failure: ApiFailure): readonly SetupCheckFault[] {
  if (failure.outcome !== "Rejected") return [];
  const read = repositoryConfigurationRefusalsSchema.safeParse(failure.body);
  if (!read.success) return [];
  return read.data.faults.slice(0, setupCheckFaultsMax).map((refusal) => ({
    path: refusal.path,
    fault: repositoryImportFault(refusal),
    detail: refusal.configurationFault,
    fields: [],
  }));
}

/** Asks the site to import `repository` at the head of its default branch, through ports that let only that write out. */
export async function setupImportAsked(
  ports: ApiPorts,
  partition: PartitionIdentity,
  repository: string,
): Promise<SetupImportAnswered> {
  const answered = await apiImportRepositoryConfigurations(ports, partition, {
    repository,
  });
  return answered.outcome === "Ok"
    ? { answered: "Imported" }
    : {
        answered: "Refused",
        refusal: repositoryImportRefusedWord(answered),
        faults: setupImportFaults(answered),
      };
}
