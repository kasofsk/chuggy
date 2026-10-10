/**
 * The setup program's fixed facts: where it is served, the Node it runs on,
 * and the addresses a sign-in uses on this machine.
 */

import { expect, test } from "vitest";

import {
  setupLoopbackAddress,
  setupNodeAccepted,
  setupNodeMajor,
  setupNodeMajorMin,
  setupProgramPath,
  setupRedirectUri,
} from "../app/core/setupProgram.ts";

test("the program is served at one fixed path no workspace can be named", () => {
  expect(setupProgramPath).toBe("/chuggy-setup.mjs");
});

test("a Node is read by its major version, and accepted from the floor up", () => {
  expect(setupNodeMajor("18.20.5")).toBe(18);
  expect(setupNodeMajor("v24.8.0")).toBeUndefined();
  expect(setupNodeMajor("")).toBeUndefined();
  expect(setupNodeAccepted(`${String(setupNodeMajorMin)}.0.0`)).toBe(true);
  expect(setupNodeAccepted(`${String(setupNodeMajorMin + 2)}.1.0`)).toBe(true);
  expect(setupNodeAccepted(`${String(setupNodeMajorMin - 1)}.99.0`)).toBe(
    false,
  );
  expect(setupNodeAccepted("nonsense")).toBe(false);
});

test("a sign-in returns to the machine's own address by number, on the listener's port", () => {
  expect(setupLoopbackAddress(41001)).toBe("http://127.0.0.1:41001/");
  expect(setupRedirectUri(41001)).toBe("http://127.0.0.1:41001/callback");
  expect(setupRedirectUri(undefined)).toBe("http://127.0.0.1/callback");
});
