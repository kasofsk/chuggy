/**
 * The batch job one assignment is placed as, and the script that makes the
 * harness exist on a host before it runs.
 *
 * UNDER `raw_exec` THERE IS NO IMAGE, SO THE POOL BRINGS THE HARNESS. A
 * container runtime is handed a digest and fetches what it names; a host
 * process is handed a command and runs whatever is at that path, which is
 * whatever somebody last put there. So the job's command is a bootstrap that
 * fetches one immutable source archive, refuses it unless its bytes hash to the
 * digest the site pinned, installs its production dependencies and runs the
 * harness's own self-check before ever exec'ing it. An installation that has
 * the release already skips every step but the last, and a release directory a
 * failed install left behind is removed rather than run.
 *
 * TWO WORKLOADS INSTALLING AT ONCE IS THE ORDINARY CASE, NOT THE RACE. The
 * directory is claimed with a `mkdir` that either succeeds for exactly one of
 * them or fails, and the rest wait for the marker the winner writes, under a
 * bound they give up at. The marker is written last, so a directory that exists
 * without one is an install in flight or one that died, never one to run.
 *
 * A CAPABILITY IS A CONSTRAINT AND NOTHING ELSE, AND ONLY WHERE THE SITE MAPS
 * ONE. A token the site maps becomes a `set_contains` against the node metadata
 * the site names, which is Nomad's own matching and a private concern of the
 * pool rather than a contract with anybody; a token it does not map contributes
 * nothing, because a pool declared its capabilities at registration and a token
 * like a provider credential is satisfied by the pool itself.
 */

/** What an installation must fetch, and what it must be before it is run. */
export interface NomadHarnessSource {
  readonly sourceUrl: string;
  readonly sourceSha256: string;
  readonly release: string;
  readonly rootPath: string;
  readonly nodePath: string;
  readonly shellPath: string;
  readonly installWaitSecsMax: number;
}

/** One placement constraint as Nomad states it, which is the only shape this adapter builds. */
export interface NomadConstraint {
  readonly LTarget: string;
  readonly Operand: string;
  readonly RTarget: string;
}

/** One file the agent renders into the task's private directory before it starts. */
export interface NomadTemplate {
  readonly DestPath: string;
  readonly EmbeddedTmpl: string;
  readonly Perms: string;
  readonly ChangeMode: string;
  readonly LeftDelim: string;
  readonly RightDelim: string;
}

/** Everything one workload job is built from, the site's parts and the assignment's together. */
export interface NomadHarnessJobInput {
  readonly id: string;
  readonly assignment: string;
  readonly datacenters: readonly string[];
  readonly constraints: readonly NomadConstraint[];
  readonly source: NomadHarnessSource;
  readonly environment: Readonly<Record<string, string>>;
  readonly templates: readonly NomadTemplate[];
  readonly cpuMegahertz: number;
  readonly memoryMib: number;
}

/** One value as a shell reads it literally, whatever a site put in it. */
export function nomadShellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const nomadHexDigest = /^[0-9a-f]{64}$/u;

const nomadHexRelease = /^[0-9a-f]{40}$/u;

/**
 * Refuses a source an installation could not verify, which is every way a
 * pinned archive stops being pinned. An unverifiable source is the one
 * configuration error that turns this backend into "run whatever is on the
 * host", so it is refused before a pool polls rather than at the first
 * placement.
 */
export function checkedNomadHarnessSource(
  source: NomadHarnessSource,
): NomadHarnessSource {
  if (!source.sourceUrl.startsWith("https://"))
    throw new RangeError("the harness source archive must be fetched over TLS");
  if (!nomadHexDigest.test(source.sourceSha256))
    throw new RangeError("the harness source digest must be hexadecimal");
  if (!nomadHexRelease.test(source.release))
    throw new RangeError("the harness release must be a full commit");
  for (const [what, path] of [
    ["harness root", source.rootPath],
    ["harness interpreter", source.nodePath],
    ["harness shell", source.shellPath],
  ] as const)
    if (!path.startsWith("/"))
      throw new RangeError(`the ${what} must be an absolute path`);
  if (
    !Number.isSafeInteger(source.installWaitSecsMax) ||
    source.installWaitSecsMax < 1
  )
    throw new RangeError("the harness install wait must be a positive integer");
  return source;
}

/** The harness this job runs, as a path under the release it was pinned to. */
const nomadHarnessEntrypoint = "src/roots/ticketWorker.ts";

/** The one file whose presence says a release is installed rather than installing. */
const nomadHarnessMarker = ".installed";

/** The step that refuses an archive whose bytes are not the ones the site pinned. */
function nomadHarnessVerification(source: NomadHarnessSource): string {
  const program =
    'const {createHash} = require("node:crypto");' +
    'const {readFileSync} = require("node:fs");' +
    'if (createHash("sha256").update(readFileSync(process.argv[1])).digest("hex") !== process.argv[2]) process.exit(1);';
  return `    "$node" -e ${nomadShellQuoted(program)} "$release/source.tgz" ${nomadShellQuoted(source.sourceSha256)}`;
}

/** The steps that turn one fetched archive into a release this host can run. */
function nomadHarnessInstall(source: NomadHarnessSource): readonly string[] {
  return [
    `    curl --fail --location --silent --show-error --output "$release/source.tgz" ${nomadShellQuoted(source.sourceUrl)}`,
    nomadHarnessVerification(source),
    '    tar --extract --gzip --file "$release/source.tgz" --directory "$release" --strip-components 1',
    '    rm -f "$release/source.tgz"',
    '    cd "$release"',
    '    "$(dirname "$node")/npm" ci --omit=dev',
    `    "$node" --experimental-strip-types ${nomadHarnessEntrypoint} --self-check`,
  ];
}

/**
 * The command one workload runs, which installs the pinned harness where it is
 * absent and execs it where it is not. Every loop in it is bounded and every
 * failure leaves nothing a later allocation would mistake for a release.
 */
export function nomadHarnessBootstrap(source: NomadHarnessSource): string {
  return [
    "set -eu",
    `root=${nomadShellQuoted(source.rootPath)}`,
    `release=${nomadShellQuoted(`${source.rootPath}/${source.release}`)}`,
    `node=${nomadShellQuoted(source.nodePath)}`,
    'mkdir -p "$root"',
    'if mkdir "$release" 2>/dev/null; then',
    "  if ! (",
    ...nomadHarnessInstall(source),
    "  ); then",
    '    rm -rf "$release"',
    "    exit 1",
    "  fi",
    `  : > "$release/${nomadHarnessMarker}"`,
    "else",
    "  waited=0",
    `  while [ ! -f "$release/${nomadHarnessMarker}" ]; do`,
    `    if [ "$waited" -ge ${String(source.installWaitSecsMax)} ]; then exit 1; fi`,
    "    sleep 1",
    "    waited=$((waited + 1))",
    "  done",
    "fi",
    'cd "$release"',
    `exec "$node" --experimental-strip-types ${nomadHarnessEntrypoint}`,
  ].join("\n");
}

/** One capability token as a constraint against the node metadata the site names. */
export function nomadCapabilityConstraint(
  metaKey: string,
  value: string,
): NomadConstraint {
  return {
    LTarget: `\${meta.${metaKey}}`,
    Operand: "set_contains",
    RTarget: value,
  };
}

/**
 * The batch job one assignment is placed as: one allocation, no restart, and
 * nothing in it that says what the work is. A restart is the orchestrator's
 * decision and not the pool's, because a second run under the same attempt
 * bearer would report a second terminal for one attempt.
 */
export function nomadHarnessJob(
  input: NomadHarnessJobInput,
): Readonly<Record<string, unknown>> {
  return {
    ID: input.id,
    Name: input.id,
    Type: "batch",
    Datacenters: input.datacenters,
    Meta: { chug_assignment: input.assignment },
    Constraints: input.constraints,
    TaskGroups: [
      {
        Name: "worker",
        Count: 1,
        RestartPolicy: { Attempts: 0, Mode: "fail" },
        ReschedulePolicy: { Attempts: 0, Unlimited: false },
        Tasks: [
          {
            Name: "worker",
            Driver: "raw_exec",
            Config: {
              command: input.source.shellPath,
              args: ["-c", nomadHarnessBootstrap(input.source)],
            },
            Env: input.environment,
            Templates: input.templates,
            Resources: {
              CPU: input.cpuMegahertz,
              MemoryMB: input.memoryMib,
            },
          },
        ],
      },
    ],
  };
}
