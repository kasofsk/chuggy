/**
 * Who the account menu says the reader is: the login and email as the access
 * plane answers them, and the initials of the login or else the email.
 */

import { expect, test } from "vitest";

import { accountInitials, accountNamed } from "../app/core/account.ts";

const subject = { subject: "member", principal: "issuer member" };

test("the initials are the first letters of a name's first two words, or of its only one", () => {
  expect(accountInitials("octocat")).toBe("O");
  expect(accountInitials("mona-lisa")).toBe("ML");
  expect(accountInitials("ada_byron-king-lovelace")).toBe("AB");
  expect(accountInitials("jane.doe")).toBe("JD");
  expect(accountInitials("--")).toBeUndefined();
});

test("the login names the reader before the email, and the email's own part stands in where there is no login", () => {
  expect(
    accountNamed({
      ...subject,
      githubLogin: "mona-lisa",
      email: "jane.doe@example.com",
    }),
  ).toStrictEqual({
    login: "mona-lisa",
    email: "jane.doe@example.com",
    initials: "ML",
  });
  expect(
    accountNamed({ ...subject, email: "jane.doe@example.com" }),
  ).toStrictEqual({
    login: undefined,
    email: "jane.doe@example.com",
    initials: "JD",
  });
});

test("an answer naming neither the login nor the email, and no answer, name nobody", () => {
  const nobody = { login: undefined, email: undefined, initials: undefined };
  expect(accountNamed(subject)).toStrictEqual(nobody);
  expect(accountNamed(undefined)).toStrictEqual(nobody);
});
