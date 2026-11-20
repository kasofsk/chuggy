import { expect, test } from "vitest";

import type { ForgeAppResponse } from "../../../src/contract/responses.ts";
import {
  repositoryConnectAskedOf,
  repositoryConnectBindable,
  repositoryConnectInstallUrl,
  repositoryConnectLeft,
  repositoryConnectNamed,
  repositoryConnectPath,
  repositoryConnectPress,
  repositoryConnectRead,
  repositoryConnectSetupAddress,
} from "../app/core/repositoryConnect.ts";
import type { RepositoryAppReach } from "../app/core/repositoryConnect.ts";
import { answeringApi } from "./answeringApi.ts";

const scratch = { owner: "gdoteof", name: "scratch" };

test("a repository is named by owner/name or by any address of it the forge shows", () => {
  for (const text of [
    "gdoteof/scratch",
    " gdoteof/scratch ",
    "https://github.com/gdoteof/scratch",
    "https://github.com/gdoteof/scratch/",
    "https://github.com/gdoteof/scratch.git",
    "github.com/gdoteof/scratch",
    "git@github.com:gdoteof/scratch.git",
  ])
    expect(repositoryConnectNamed(text), text).toStrictEqual(scratch);
});

test("text naming no owner and name, or more than them, names no repository", () => {
  for (const text of [
    "",
    "scratch",
    "gdoteof/",
    "/scratch",
    "gdoteof/scratch/tree/main",
    "https://github.com/gdoteof",
    "gdoteof/..",
    "gd oteof/scratch",
  ])
    expect(repositoryConnectNamed(text), text).toBeUndefined();
});

test("an address carries the repository and who sent the person, and loses both and its anchor when asked", () => {
  const page = "/acme/atlas/repositories";
  const setup = repositoryConnectSetupAddress(page, "gdoteof/scratch", "add");
  expect(setup).toBe(`${page}?repository=gdoteof%2Fscratch&from=setup#add`);
  expect(repositoryConnectAskedOf(setup)).toStrictEqual({
    repository: scratch,
    arrival: "Setup",
  });
  expect(repositoryConnectSetupAddress(page, undefined, "add")).toBe(
    `${page}?from=setup#add`,
  );
  expect(repositoryConnectAskedOf(page)).toStrictEqual({
    repository: undefined,
    arrival: "Console",
  });
  expect(
    repositoryConnectPath(`${setup}`, {
      repository: undefined,
      arrival: "Console",
    }),
  ).toBe(page);
  expect(
    repositoryConnectPath(`${page}?other=1`, {
      repository: scratch,
      arrival: "Console",
    }),
  ).toBe(`${page}?other=1&repository=gdoteof%2Fscratch`);
});

const worker: ForgeAppResponse = {
  app: "worker",
  id: "2",
  slug: "chuggy-worker",
  installUrl: "https://forge.test/apps/chuggy-worker/installations/new",
};

const entry = {
  id: "102",
  name: "scratch",
  fullName: "gdoteof/scratch",
  url: "https://forge.test/gdoteof/scratch",
  defaultBranch: "main",
  private: false,
};

test("an app's install has the account and repository chosen only where the other app's listing gave the forge's numbers for both", () => {
  const known: readonly RepositoryAppReach[] = [
    { app: "portal", reach: "Reaches", entry, accountId: "77" },
    { app: "worker", reach: "Uninstalled" },
  ];
  expect(repositoryConnectInstallUrl(worker, "s", known)).toStrictEqual({
    url: `${worker.installUrl}/permissions?suggested_target_id=77&repository_ids[]=102&state=s`,
    chosen: true,
  });
  const unknown: readonly RepositoryAppReach[] = [
    { app: "portal", reach: "Reaches", entry, accountId: undefined },
    { app: "worker", reach: "Uninstalled" },
  ];
  expect(repositoryConnectInstallUrl(worker, "s", unknown).chosen).toBe(false);
  const neither: readonly RepositoryAppReach[] = [
    { app: "portal", reach: "Uninstalled" },
    { app: "worker", reach: "Uninstalled" },
  ];
  expect(repositoryConnectInstallUrl(worker, "s", neither)).toStrictEqual({
    url: `${worker.installUrl}?state=s`,
    chosen: false,
  });
});

test("a press from the flow counts both apps as sent, so a landing returns to the flow rather than on to the other install", () => {
  expect(repositoryConnectPress("acme", "/back#add")).toStrictEqual({
    tenant: "acme",
    returnPath: "/back#add",
    installs: ["portal", "worker"],
  });
});

const claim = (app: string, account: string, installationId: string) => ({
  forge: "github",
  app,
  account,
  accountKind: "User",
  installationId,
  claimedAt: "2026-09-11T00:00:00Z",
});

/** The tenant's claims and each installation's listing and page, by path. */
function forgeAnswering(
  listings: Readonly<Record<string, readonly unknown[]>>,
) {
  return answeringApi((_method, path) => {
    if (path.endsWith("/forge-installations"))
      return {
        status: 200,
        body: {
          truncated: false,
          installations: [
            claim("portal", "GDoteof", "13"),
            claim("worker", "gdoteof", "14"),
            claim("worker", "kasofsk", "12"),
          ],
        },
      };
    const id = /\/forge-installations\/(\d+)\//u.exec(path)?.[1] ?? "";
    if (path.endsWith("/permissions"))
      return {
        status: 200,
        body: {
          permissions: "Current",
          settingsUrl: `https://forge.test/settings/${id}`,
        },
      };
    return {
      status: 200,
      body: {
        truncated: false,
        selection: "Selected",
        repositories: listings[id] ?? [],
        accountId: "77",
      },
    };
  });
}

test("each app is read on the account that owns the repository alone: one listing it reaches it, one that does not is not let in, with its page", async () => {
  const { ports, sent } = forgeAnswering({ "13": [entry], "14": [] });
  const read = await repositoryConnectRead(ports, "acme", scratch);
  expect(read).toStrictEqual({
    outcome: "Ok",
    value: [
      { app: "portal", reach: "Reaches", entry, accountId: "77" },
      {
        app: "worker",
        reach: "Ungranted",
        settings: "https://forge.test/settings/14",
      },
    ],
  });
  expect(sent.some((one) => one.path.includes("/12/"))).toBe(false);
  if (read.outcome !== "Ok") throw new Error("unread");
  expect(repositoryConnectBindable(read.value)).toBeUndefined();
  expect(repositoryConnectLeft(read.value)).toStrictEqual(["worker"]);
});

test("an app no claim names on the owner is not installed, and once both reach it the portal app's entry is what is bound", async () => {
  const none = await repositoryConnectRead(forgeAnswering({}).ports, "acme", {
    owner: "elsewhere",
    name: "scratch",
  });
  expect(
    none.outcome === "Ok" && repositoryConnectLeft(none.value),
  ).toStrictEqual(["portal", "worker"]);
  const both = await repositoryConnectRead(
    forgeAnswering({ "13": [entry], "14": [entry] }).ports,
    "acme",
    { owner: "gdoteof", name: "SCRATCH" },
  );
  expect(
    both.outcome === "Ok" && repositoryConnectBindable(both.value),
  ).toStrictEqual(entry);
});

test("a listing that does not answer is the answer for both apps", async () => {
  const { ports } = answeringApi((_method, path) =>
    path.endsWith("/forge-installations")
      ? {
          status: 200,
          body: {
            truncated: false,
            installations: [claim("portal", "gdoteof", "13")],
          },
        }
      : { status: 503, body: {} },
  );
  const read = await repositoryConnectRead(ports, "acme", scratch);
  expect(read.outcome).not.toBe("Ok");
});
