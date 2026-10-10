/**
 * The setup program's arguments: a closed grammar, read to what was asked or
 * to which part of it could not be read.
 */

import { expect, test } from "vitest";

import {
  setupAnswerArguments,
  setupAnswersAsked,
  setupAnswersNone,
  setupAsked,
  setupCommandArguments,
  setupListenArguments,
  setupListenSecsDefault,
  setupSiteRead,
  setupWaitSecsDefault,
  setupWaitSecsMax,
} from "../app/core/setupArguments.ts";

const site = "https://chuggy.example";

function wrongly(fault: string) {
  return { asked: "Wrongly", fault };
}

test("with no arguments the program is asked where things stand", () => {
  expect(setupAsked([])).toEqual({
    asked: "Status",
    site: undefined,
    answers: setupAnswersNone,
  });
});

test("a flag's value is the next argument or what follows its equals sign", () => {
  const asked = { asked: "Status", site, answers: setupAnswersNone };
  expect(setupAsked(["--site", site])).toEqual(asked);
  expect(setupAsked([`--site=${site}`])).toEqual(asked);
});

test("sign-in waits ninety seconds unless told how long, and flags may come before the command", () => {
  expect(setupWaitSecsDefault).toBe(90);
  expect(setupAsked(["sign-in"])).toEqual({
    asked: "SignIn",
    site: undefined,
    waitSecs: setupWaitSecsDefault,
    answers: setupAnswersNone,
  });
  expect(setupAsked(["--wait-secs", "5", "sign-in", "--site", site])).toEqual({
    asked: "SignIn",
    site,
    waitSecs: 5,
    answers: setupAnswersNone,
  });
});

test("the bare command and sign-in each read a workspace and a project, either alone or both, and a listener reads neither", () => {
  const both = { workspace: "acme", project: "widgets" };
  const argv = ["--workspace", "acme", "--project=widgets"];
  expect(setupAsked(argv)).toMatchObject({ asked: "Status", answers: both });
  expect(setupAsked(["sign-in", ...argv])).toMatchObject({
    asked: "SignIn",
    answers: both,
  });
  expect(setupAsked(["--project", "widgets"])).toMatchObject({
    answers: { workspace: undefined, project: "widgets" },
  });
  expect(setupAsked(["listen", "--site", site, ...argv])).toEqual(
    wrongly("Flag"),
  );
});

/** Names a site may hold that a shell, or this program's own grammar, could read as something else. */
const awkward = [
  "acme",
  "two words",
  "it's",
  "--project",
  "sign-in",
  "a=b",
  "$HOME",
  "`id`",
  "a;b",
  "naïve",
];

test("a name is whatever one argument holds, and is read back from the arguments a report names for it", () => {
  for (const workspace of awkward)
    for (const project of [undefined, ...awkward]) {
      const answers = { workspace, project };
      const said = JSON.stringify(answers);
      const argv = setupAnswerArguments(answers);
      expect(setupAsked(argv), said).toMatchObject({
        asked: "Status",
        answers,
      });
      expect(setupAnswersAsked(["sign-in", ...argv]), said).toEqual(answers);
    }
  expect(setupAnswerArguments(setupAnswersNone)).toEqual([]);
});

test("a run asked wrongly, and a listener, carry no names", () => {
  expect(setupAnswersAsked(["--workspace", "acme", "--verbose"])).toEqual(
    setupAnswersNone,
  );
  expect(
    setupAnswersAsked(setupListenArguments(site, setupListenSecsDefault)),
  ).toEqual(setupAnswersNone);
});

test("a site is its origin, whatever address of it was given", () => {
  expect(setupSiteRead("https://chuggy.example/acme/widgets?x=1#y")).toBe(site);
  expect(setupSiteRead("HTTPS://Chuggy.Example:8443/")).toBe(
    "https://chuggy.example:8443",
  );
});

test("plain HTTP is a site only at this machine's own address", () => {
  expect(setupSiteRead("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
  for (const refused of [
    "http://chuggy.example",
    "http://localhost:8080",
    "http://127.0.0.1.example",
    "ftp://chuggy.example",
    "chuggy.example",
    "https://person:secret@chuggy.example",
    "",
  ])
    expect(setupSiteRead(refused), refused).toBeUndefined();
});

test.each([
  [["sign-out"], "Command"],
  [["sign-in", "sign-in"], "Command"],
  [["sign-in", "extra"], "Command"],
  [["constructor"], "Command"],
  [["--verbose", "1"], "Flag"],
  [["--site"], "Flag"],
  [["--site", site, "--site", site], "Flag"],
  [["--wait-secs", "5"], "Flag"],
  [["sign-in", "--life-secs", "5"], "Flag"],
  [["--"], "Flag"],
  [["--site", "not an address"], "Site"],
  [["--site", "http://chuggy.example"], "Site"],
  [["--workspace", ""], "Name"],
  [["--workspace", " acme"], "Name"],
  [["--project", "wid  gets"], "Name"],
  [["--project", "wid\ngets"], "Name"],
  [["--workspace", "acme", "--project", "wid\u001bgets"], "Name"],
  [["sign-in", "--workspace", "acme\u202e"], "Name"],
  [["--workspace", "acme", "--workspace", "acme"], "Flag"],
  [["--workspace"], "Flag"],
  [["sign-in", "--wait-secs", "soon"], "WaitSecs"],
  [["sign-in", "--wait-secs", "-1"], "WaitSecs"],
  [["sign-in", "--wait-secs", "1.5"], "WaitSecs"],
  [["sign-in", "--wait-secs", String(setupWaitSecsMax + 1)], "WaitSecs"],
  [["listen", "--site", site, "--life-secs", "9999999"], "WaitSecs"],
  [["listen"], "Site"],
])("%j is asked wrongly: %s", (argv, fault) => {
  expect(setupAsked(argv)).toEqual(wrongly(fault));
});

test("the longest wait is read, and no wait at all", () => {
  expect(
    setupAsked(["sign-in", `--wait-secs=${String(setupWaitSecsMax)}`]),
  ).toMatchObject({ waitSecs: setupWaitSecsMax });
  expect(setupAsked(["sign-in", "--wait-secs", "0"])).toMatchObject({
    waitSecs: 0,
  });
});

test("the arguments a report names for a command are read back as that command", () => {
  expect(setupAsked(setupCommandArguments("Status")).asked).toBe("Status");
  expect(setupAsked(setupCommandArguments("SignIn")).asked).toBe("SignIn");
  expect(
    setupAsked([
      ...setupCommandArguments("Runner"),
      ...setupAnswerArguments({ workspace: "acme", project: "widgets" }),
    ]).asked,
  ).toBe("Runner");
});

test("runner is read only with the workspace and the project it is for, waits as sign-in does, and takes a site", () => {
  const named = ["--workspace", "acme", "--project", "two words"];
  const answers = { workspace: "acme", project: "two words" };
  expect(setupAsked(["runner", ...named])).toEqual({
    asked: "Runner",
    site: undefined,
    waitSecs: setupWaitSecsDefault,
    answers,
    ...answers,
  });
  expect(
    setupAsked([...named, "--wait-secs=5", "runner", "--site", site]),
  ).toEqual({ asked: "Runner", site, waitSecs: 5, answers, ...answers });
  for (const argv of [
    ["runner"],
    ["runner", "--workspace", "acme"],
    ["runner", "--project", "widgets"],
  ])
    expect(setupAsked(argv), argv.join(" ")).toEqual(wrongly("Project"));
  expect(setupAsked(["runner", ...named, "--life-secs", "5"])).toEqual(
    wrongly("Flag"),
  );
  expect(setupAsked(["runner", "sign-in", ...named])).toEqual(
    wrongly("Command"),
  );
  expect(
    setupAsked(["runner", "--workspace", "a\nb", "--project", "c"]),
  ).toEqual(wrongly("Name"));
  expect(setupAnswersAsked(["runner", ...named])).toEqual(answers);
});

test("the arguments a sign-in starts its listener with are read back as that listener", () => {
  expect(
    setupAsked(setupListenArguments(site, setupListenSecsDefault)),
  ).toEqual({ asked: "Listen", site, lifeSecs: setupListenSecsDefault });
});
