/**
 * The setup program's entry as a process: how it exits, the shape of what it
 * prints, and that nothing secret is in any of it.
 *
 * The last is the control for the rule that no secret is ever printed. A
 * whole session is run against the stand-in installation — signing in,
 * renewing, and every way a sign-in fails — and everything the program wrote
 * to either stream, every page it answered the browser with, the note each
 * listener left while it waited, and the name and the text of everything it
 * keeps besides the file that holds the sign-in, is searched for every value
 * the issuer handed out and every secret of the exchange the program itself
 * drew. The session ends with the checklist read in a checkout whose remote
 * carries a credential, which is searched for with the rest.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { browsed, dialect, making } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";
import { setupSiteAt } from "../../ui/chuggy-ui/test/setupSite.ts";

const made = making();

const wrongly: readonly (readonly string[])[] = [
  ["sign-out"],
  ["sign-in", "now"],
  ["--verbose"],
  ["--site"],
  ["--site", "https://chuggy.invalid", "--site", "https://chuggy.invalid"],
  ["--site", "chuggy.invalid"],
  ["--site", "https://person:hunter2@chuggy.invalid"],
  ["--site", "http://localhost:4444"],
  ["sign-in", "--wait-secs", "soon"],
  ["sign-in", "--wait-secs", "999999"],
  ["--wait-secs", "5"],
  ["listen"],
  ["--help"],
];

test("a program asked wrongly exits two, says which way, and repeats nothing it was given", async () => {
  const machine = made.machine();
  for (const argv of wrongly) {
    const said = argv.join(" ");
    const done = await machine.run(argv);
    assert.equal(done.code, 2, said);
    dialect(done, said);
    assert.match(done.lines[0] ?? "", /^found: /u, said);
    assert.match(done.lines.at(-1) ?? "", /^next: node \S+$/u, said);
    for (const given of ["hunter2", "soon", "sign-out", "verbose", "invalid"])
      assert.ok(!done.stdout.includes(given), said);
  }
  assert.deepEqual(readdirSync(machine.home), []);
});

test("with no site given and none remembered the program exits two, says what to pass, and names no command it could not run", async () => {
  const done = await made.machine().run([]);
  assert.equal(done.code, 2);
  dialect(done, "bare");
  assert.equal(done.lines.length, 3);
  assert.equal(
    done.lines[0],
    "found: no chuggy site is remembered on this machine yet",
  );
  assert.match(
    done.lines[1] ?? "",
    /^rule: Run node \S+ --site with the address of the person's chuggy site after it, such as https:\/\/chuggy\.example\. Ask the person for the address if you do not have it\.$/u,
  );
  assert.equal(done.lines[2], "next: stop");
});

test("a site that does not answer is a failure that exits one and stops, with the command to try again under the person's say-so", async () => {
  const done = await made
    .machine()
    .run(["sign-in", "--site", "http://127.0.0.1:9"]);
  assert.equal(done.code, 1);
  dialect(done, "sign-in");
  assert.deepEqual(done.lines.slice(0, 3), [
    "site: http://127.0.0.1:9, no answer",
    "found: the site did not answer",
    "tell: http://127.0.0.1:9 did not answer, so chuggy setup did nothing. Check the address and that this machine can reach it, and tell me if you want me to try again.",
  ]);
  assert.match(
    done.lines[3] ?? "",
    /^rule: Run node \S+ sign-in --site http:\/\/127\.0\.0\.1:9 only if the person asks to try again\.$/u,
  );
  assert.deepEqual(done.lines.slice(4), ["next: stop"]);
});

test("a machine that names no home is a report and not a trace, and nothing is kept in the folder the program was run in", async () => {
  const machine = made.machine();
  const site = "http://127.0.0.1:9";
  for (const argv of [
    ["--site", site],
    ["sign-in", "--site", site],
  ]) {
    const done = await machine.run(argv, { HOME: "" });
    assert.equal(done.code, 1);
    dialect(done, argv.join(" "));
    assert.deepEqual(done.lines.slice(0, 2), [
      "found: this machine did not say where the person's home directory is",
      "tell: chuggy setup keeps its sign-in in your home directory, and this machine did not say where that is. Tell me once HOME is set.",
    ]);
    assert.match(
      done.lines[2] ?? "",
      /^rule: Run node \S+ (sign-in )?--site http:\/\/127\.0\.0\.1:9 only once HOME names the person's home directory\.$/u,
    );
    assert.deepEqual(done.lines.slice(3), ["next: stop"]);
  }
  assert.deepEqual(readdirSync(machine.folder), []);
  assert.deepEqual(readdirSync(machine.home), []);
});

interface Session {
  readonly installation: StandIn;
  readonly machine: Home;
  /** Every page the program answered the browser with. */
  readonly pages: string[];
  /** The note each sign-in's listener left while its page was waiting. */
  readonly notes: string[];
  readonly runs: Ran[];
}

/** One `sign-in` with the suite as the person, altering what comes back where a case asks; the same answer under another sign-in's state is sent first, which the page takes for nobody's. */
async function signIn(
  session: Session,
  altered: (back: URL) => void = () => undefined,
): Promise<void> {
  const { installation, machine, pages, runs } = session;
  const running = machine.run(["sign-in", "--site", installation.site]);
  const sent = await browsed(await machine.opened());
  session.notes.push(machine.file("sign-in.json") ?? "");
  pages.push(await sent.text());
  const allowed = await browsed(sent.headers.get("location") ?? "");
  const back = new URL(allowed.headers.get("location") ?? "");
  const strayed = new URL(back.href);
  strayed.searchParams.set("state", "another-sign-ins");
  pages.push(await (await browsed(strayed.href)).text());
  altered(back);
  pages.push(await (await browsed(back.href)).text());
  runs.push(await running);
}

/** What the remote of the session's checkout carries before its host, which nothing printed may hold. */
const remoteSecret = "ghp_r3m0teCredentialNeverPrinted";

/** Every way a sign-in ends against the stand-in, and the commands around them. */
async function sessionRun(): Promise<Session> {
  const installation = await made.installation();
  const session: Session = {
    installation,
    machine: made.machine(),
    pages: [],
    notes: [],
    runs: [],
  };
  const bare = async () => {
    session.runs.push(await session.machine.run([]));
  };
  installation.allows = false;
  await signIn(session);
  installation.allows = true;
  await signIn(session, (back) => {
    back.searchParams.set("code", "not-the-code");
  });
  installation.renewable = false;
  await signIn(session);
  installation.renewable = true;
  await bare();
  installation.serves = false;
  await signIn(session);
  await bare();
  installation.serves = true;
  installation.admits = false;
  await bare();
  await signIn(session);
  installation.admits = true;
  rmSync(join(session.machine.directory, "session.json"));
  await signIn(session);
  await bare();
  await bare();
  session.runs.push(await session.machine.run(["sign-in", "--wait-secs", "0"]));
  await session.machine.checkout(
    `https://deploy:${remoteSecret}@github.com/acme-org/widgets.git`,
  );
  for (const stage of ["Portal", "Landed"] as const) {
    installation.world = setupSiteAt(stage);
    await bare();
  }
  return session;
}

/** The secrets of an exchange the program drew for itself, as the issuer was sent them. */
function drawn(installation: StandIn): string[] {
  const secrets: string[] = [];
  for (const asked of installation.asked) {
    const query = new URLSearchParams(asked.slice(asked.indexOf("?") + 1));
    for (const name of ["state", "code_challenge"]) {
      const value = query.get(name);
      if (value !== null && asked.includes("/oauth2/auth?"))
        secrets.push(value);
    }
    const verifier = new URLSearchParams(asked).get("code_verifier");
    if (verifier !== null) secrets.push(verifier);
  }
  return secrets;
}

/** How each run of the session ends, in order: what it exits with, and what it found or, finding nothing, said first. */
function sessionEndings(site: string): readonly (readonly [number, string])[] {
  const signedIn = `site: ${site}, signed in`;
  return [
    [0, "found: the sign-in was declined in the browser"],
    [1, "found: the sign-in server did not accept the answer"],
    [0, "found: the sign-in was allowed without leave to stay signed in"],
    [0, "found: the sign-in was allowed without leave to stay signed in"],
    [
      1,
      "found: the sign-in went through, but the site did not say which workspaces are yours",
    ],
    [1, "found: the site did not say which workspaces are yours (Fault)"],
    [1, "found: the site refused the remembered sign-in, so it was forgotten"],
    [
      1,
      "found: the sign-in went through, but the site refused it, so nothing is remembered",
    ],
    ...Array.from({ length: 6 }, () => [0, signedIn] as const),
  ];
}

test("across every way a sign-in ends, nothing the issuer handed out and nothing the exchange drew is in anything the program wrote", async () => {
  const { installation, machine, pages, notes, runs } = await sessionRun();
  assert.deepEqual(
    runs.map((done) => [
      done.code,
      done.lines.find((text) => text.startsWith("found: ")) ?? done.lines[0],
    ]),
    sessionEndings(installation.site),
  );
  assert.equal(
    runs.at(-2)?.lines[4],
    "step: repository  todo     github.com/acme-org/widgets (this folder's remote)",
  );
  assert.deepEqual(
    runs.flatMap((done) =>
      done.lines.filter((text) => text.startsWith("step: workspace ")),
    ),
    Array.from({ length: 4 }, () => "step: workspace   done     acme"),
  );
  for (const done of runs) dialect(done, done.stdout);

  const secrets = [
    ...installation.issued,
    ...drawn(installation),
    remoteSecret,
  ];
  assert.ok(installation.issued.size >= 9, String(installation.issued.size));
  assert.ok(secrets.length > installation.issued.size);
  const kept = readdirSync(machine.directory, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.name !== "session.json")
    .map((entry) =>
      entry.isFile()
        ? `${entry.name}\n${readFileSync(join(entry.parentPath, entry.name), "utf8")}`
        : entry.name,
    );
  assert.deepEqual(kept, ["lock", "free\n"]);
  for (const note of notes) assert.match(note, /"note":"Waiting"/u);
  const wrote = [...machine.written, ...pages, ...notes, ...kept].join("\n");
  assert.ok(wrote.includes(installation.site));
  for (const secret of secrets) {
    assert.ok(secret.length >= 16);
    assert.ok(!wrote.includes(secret));
  }
});

test("the file that holds the sign-in holds the site and the renewal token, and nothing else", async () => {
  const { installation, machine } = await sessionRun();
  const stored = JSON.parse(machine.file("session.json") ?? "{}") as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(stored).toSorted(), ["refreshToken", "site"]);
  assert.equal(stored["site"], installation.site);
  assert.ok(stored["refreshToken"] === installation.renewal());
  assert.deepEqual(readdirSync(machine.directory).toSorted(), [
    "lock",
    "session.json",
  ]);
});
