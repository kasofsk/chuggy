/**
 * Where the welcome page says a reader stands, as it is decided from their
 * own workspaces: the workspace they administer wherever one is listed, every
 * workspace they are in where they administer none, none where the list
 * answers none, and a read that has not answered where it has not or where a
 * list cut short names nothing. And what a workspace's people list says of
 * the reader's own login and of the other admins.
 */

import { expect, test } from "vitest";

import type {
  AccessCallerTenant,
  AccessCallerTenants,
  AccessTenantPerson,
} from "../../../src/contract/accessPlane.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  welcomePeople,
  welcomeStanding,
  welcomeWorkspace,
} from "../app/core/welcome.ts";

function listed(tenant: string, administer: boolean): AccessCallerTenant {
  return {
    tenant,
    displayName: `${tenant} name`,
    roles: administer ? ["Admin"] : ["Member"],
    administer,
  };
}

function ready(
  tenants: readonly AccessCallerTenant[],
  truncated = false,
): PanelState<AccessCallerTenants> {
  return {
    state: "Ready",
    value: { tenants: [...tenants], truncated },
    observedAtMs: 0,
  };
}

test("a workspace the reader administers is where they stand, wherever the list answers it", () => {
  const standing = welcomeStanding(
    ready([listed("harbour", false), listed("mine", true)]),
  );
  expect(standing).toStrictEqual({
    standing: "Admin",
    workspace: listed("mine", true),
  });
  expect(welcomeWorkspace(standing)).toStrictEqual(listed("mine", true));
});

test("a reader who administers none stands in every workspace listed, and the page reads the first one's people", () => {
  const standing = welcomeStanding(
    ready([listed("harbour", false), listed("zephyr", false)], true),
  );
  expect(standing).toStrictEqual({
    standing: "Member",
    workspaces: [listed("harbour", false), listed("zephyr", false)],
  });
  expect(welcomeWorkspace(standing)?.tenant).toBe("harbour");
});

test("a list that answers no workspace is none, and one cut short that names none is no answer", () => {
  expect(welcomeStanding(ready([]))).toStrictEqual({ standing: "None" });
  expect(welcomeWorkspace({ standing: "None" })).toBeUndefined();
  expect(welcomeStanding(ready([], true))).toStrictEqual({
    standing: "Unread",
    state: { state: "Absent" },
  });
  expect(welcomeStanding({ state: "Pending" })).toStrictEqual({
    standing: "Unread",
    state: { state: "Pending" },
  });
});

function person(
  subject: string,
  admin: boolean,
  mine: boolean,
  githubLogin?: string,
): AccessTenantPerson {
  return {
    subject,
    mine,
    tenantRoles: admin ? ["Admin"] : ["Member"],
    hostedRuns: false,
    personalRunners: false,
    unscopedChat: true,
    projects: [],
    account: true,
    email: `${subject}@example.test`,
    ...(githubLogin === undefined ? {} : { githubLogin }),
  };
}

test("the people list says the reader's own login and every other admin, by login or else by email", () => {
  expect(
    welcomePeople({
      tenant: "harbour",
      projects: [],
      people: [
        person("me", true, true, "octocat"),
        person("ada", true, false, "ada-l"),
        person("bob", false, false, "bobby"),
        person("cy", true, false),
      ],
      otherIssuers: 0,
      truncated: false,
    }),
  ).toStrictEqual({
    login: "octocat",
    admins: ["ada-l", "cy@example.test"],
  });
});
