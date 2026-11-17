/**
 * The caller's own account over a directory held in memory: the caller's own
 * email and login and nobody else's, the directory's fields absent where it
 * holds none or there is no directory, and an outage thrown as a list's is.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { accessCallerAccount } from "../../src/interpreter/accessCallerAccount.ts";
import {
  AccessDirectoryUnavailable,
  type AccessAccount,
  type AccessDirectory,
} from "../../src/interpreter/accessDirectory.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import { directorySubject } from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePrincipal,
} from "./accessPlaneFixture.ts";

const una = directorySubject(1);
const other = directorySubject(2);

/** A directory answering every subject asked from `accounts`, recording each question, or failing each where `unavailable`. */
function directoryOf(accounts: readonly AccessAccount[], unavailable = false) {
  const asked: (readonly string[])[] = [];
  const refused = () => Promise.reject(new Error("not asked of this read"));
  const directory: AccessDirectory = {
    githubHolder: refused,
    emailHeld: refused,
    create: refused,
    accounts: (subjects) => {
      asked.push(subjects);
      if (unavailable)
        return Promise.reject(
          new AccessDirectoryUnavailable("the directory is not there"),
        );
      return Promise.resolve(accounts);
    },
  };
  return { directory, asked };
}

function read(directory: AccessDirectory | undefined, subject: string) {
  return accessCallerAccount(
    { directory },
    { issuer: accessFixtureIssuer },
  ).callerAccount(accessFixturePrincipal(subject));
}

test("a caller is answered their own email and login, the directory asked about them alone and its answer about anyone else ignored", async () => {
  const { directory, asked } = directoryOf([
    { subject: other, email: "other@example.com", githubLogin: "Other" },
    { subject: una, email: "una@example.com", githubLogin: "Una-Cat" },
  ]);
  assert.deepEqual(await read(directory, una), {
    subject: una,
    principal: accessFixturePrincipal(una),
    account: true,
    email: "una@example.com",
    githubLogin: "Una-Cat",
  });
  assert.deepEqual(asked, [[una]]);
});

test("an account the directory holds no email or login for is answered without either", async () => {
  const { directory } = directoryOf([{ subject: una }]);
  assert.deepEqual(await read(directory, una), {
    subject: una,
    principal: accessFixturePrincipal(una),
    account: true,
  });
});

test("a subject the directory holds no account under is answered as no account, and one of no account's shape without asking", async () => {
  const { directory, asked } = directoryOf([
    { subject: other, email: "other@example.com", githubLogin: "Other" },
  ]);
  assert.deepEqual(await read(directory, una), {
    subject: una,
    principal: accessFixturePrincipal(una),
    account: false,
  });
  assert.deepEqual(await read(directory, "chuggy-selector"), {
    subject: "chuggy-selector",
    principal: accessFixturePrincipal("chuggy-selector"),
    account: false,
  });
  assert.deepEqual(asked, [[una]]);
});

test("a plane with no directory answers the subject and principal alone", async () => {
  assert.deepEqual(await read(undefined, una), {
    subject: una,
    principal: accessFixturePrincipal(una),
  });
});

test("a directory that cannot answer is thrown as a list's outage is", async () => {
  const { directory } = directoryOf([], true);
  await assert.rejects(read(directory, una), AccessDirectoryUnavailable);
});

test("a principal under another issuer is answered absent and the directory is not asked", async () => {
  const { directory, asked } = directoryOf([{ subject: una }]);
  assert.equal(
    await accessCallerAccount(
      { directory },
      { issuer: accessFixtureIssuer },
    ).callerAccount(oidcPrincipal("https://elsewhere.invalid", una)),
    undefined,
  );
  assert.deepEqual(asked, []);
});
