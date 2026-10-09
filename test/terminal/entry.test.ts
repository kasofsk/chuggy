/**
 * The setup program's entry as a process: how it exits, the shape of what it
 * prints, and that nothing secret is in any of it.
 *
 * The last is the control for the rule that no secret is ever printed. A
 * whole session is run against the stand-in installation — signing in,
 * renewing, and every way a sign-in fails — and everything the program wrote
 * to either stream, every page it answered the browser with, the note each
 * listener left while it waited and every file it keeps besides the one that
 * holds the sign-in is searched for every value the issuer handed out and
 * every secret of the exchange the program itself drew.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { browsed, making } from "./program.ts";
import type { Home, Ran } from "./program.ts";
import type { StandIn } from "./standIn.ts";

const made = making();

const line = /^(site|workspace|found|did|tell|rule|next): \S.*$/u;

/** What every run prints: lines of the dialect, one `next:` and it last, and nothing on the other stream. */
function dialect(done: Ran, said: string): void {
  assert.equal(done.stderr, "", said);
  assert.ok(done.stdout.endsWith("\n"), said);
  assert.ok(done.lines.length > 0, said);
  for (const text of done.lines) assert.match(text, line, said);
  assert.deepEqual(
    done.lines.filter((text) => text.startsWith("next: ")),
    [done.lines.at(-1)],
    said,
  );
}

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
  assert.deepEqual(readdirSync(machine.home), ["opener.sh"]);
});

test("with no site given and none remembered the program exits two and names the flag", async () => {
  const done = await made.machine().run([]);
  assert.equal(done.code, 2);
  dialect(done, "bare");
  assert.match(
    done.lines.at(-1) ?? "",
    /^next: node \S+ --site '<the address of your chuggy site>'$/u,
  );
});

test("a site that does not answer is a failure that exits one, and names the command to run again", async () => {
  const done = await made
    .machine()
    .run(["sign-in", "--site", "http://127.0.0.1:9"]);
  assert.equal(done.code, 1);
  dialect(done, "sign-in");
  assert.deepEqual(done.lines.slice(0, -1), [
    "site: http://127.0.0.1:9, no answer",
  ]);
  assert.match(
    done.lines.at(-1) ?? "",
    /^next: node \S+ sign-in --site http:\/\/127\.0\.0\.1:9$/u,
  );
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

/** One `sign-in` with the suite as the person, altering what comes back where a case asks. */
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
  altered(back);
  pages.push(await (await browsed(back.href)).text());
  runs.push(await running);
}

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
    back.searchParams.set("state", "another-sign-ins");
  });
  await signIn(session, (back) => {
    back.searchParams.set("code", "not-the-code");
  });
  installation.renewable = false;
  await signIn(session);
  installation.renewable = true;
  await bare();
  await signIn(session);
  await bare();
  await bare();
  session.runs.push(await session.machine.run(["sign-in", "--wait-secs", "0"]));
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

test("across every way a sign-in ends, nothing the issuer handed out and nothing the exchange drew is in anything the program wrote", async () => {
  const { installation, machine, pages, notes, runs } = await sessionRun();
  const signedIn = `site: ${installation.site}, signed in`;
  assert.deepEqual(
    runs.map((done) => [
      done.code,
      done.lines.find((text) => text.startsWith("found: ")) ?? done.lines[0],
    ]),
    [
      [0, "found: the sign-in was declined in the browser"],
      [0, "found: the answer that came back did not belong to this sign-in"],
      [1, "found: the sign-in server did not accept the answer"],
      [0, "found: the sign-in was allowed without leave to stay signed in"],
      [0, `site: ${installation.site}, not signed in`],
      [0, signedIn],
      [0, signedIn],
      [0, signedIn],
      [0, signedIn],
    ],
  );
  for (const done of runs) dialect(done, done.stdout);

  const secrets = [...installation.issued, ...drawn(installation)];
  assert.ok(installation.issued.size >= 9, String(installation.issued.size));
  assert.ok(secrets.length > installation.issued.size);
  const kept = readdirSync(machine.directory)
    .filter((name) => name !== "session.json")
    .map((name) => readFileSync(join(machine.directory, name), "utf8"));
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
  assert.deepEqual(readdirSync(machine.directory), ["session.json"]);
});
