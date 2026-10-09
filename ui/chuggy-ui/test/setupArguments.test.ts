/**
 * The setup program's arguments: a closed grammar, read to what was asked or
 * to which part of it could not be read.
 */

import { expect, test } from "vitest";

import {
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
  expect(setupAsked([])).toEqual({ asked: "Status", site: undefined });
});

test("a flag's value is the next argument or what follows its equals sign", () => {
  const asked = { asked: "Status", site };
  expect(setupAsked(["--site", site])).toEqual(asked);
  expect(setupAsked([`--site=${site}`])).toEqual(asked);
});

test("sign-in waits ninety seconds unless told how long, and flags may come before the command", () => {
  expect(setupWaitSecsDefault).toBe(90);
  expect(setupAsked(["sign-in"])).toEqual({
    asked: "SignIn",
    site: undefined,
    waitSecs: setupWaitSecsDefault,
  });
  expect(setupAsked(["--wait-secs", "5", "sign-in", "--site", site])).toEqual({
    asked: "SignIn",
    site,
    waitSecs: 5,
  });
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
});

test("the arguments a sign-in starts its listener with are read back as that listener", () => {
  expect(
    setupAsked(setupListenArguments(site, setupListenSecsDefault)),
  ).toEqual({ asked: "Listen", site, lifeSecs: setupListenSecsDefault });
});
