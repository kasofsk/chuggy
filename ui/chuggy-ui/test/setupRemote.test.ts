/**
 * The folder's remote, as the setup program reads it: an address is kept as
 * a host and a path, whatever else it held, and what is no address of a
 * repository on a host is no remote.
 */

import { expect, test } from "vitest";

import {
  setupRemoteBytesMax,
  setupRemoteCommand,
  setupRemoteRead,
  setupRemoteWaitMs,
  setupRepositoryRead,
} from "../app/core/setupRemote.ts";
import type { SetupProcessPort } from "../app/core/setupPorts.ts";

const said = "github.com/acme-org/widgets";

test.each([
  "https://github.com/acme-org/widgets",
  "https://github.com/acme-org/widgets.git",
  "https://github.com/acme-org/widgets/",
  "https://github.com//acme-org/widgets.git/",
  "http://github.com/acme-org/widgets",
  "git@github.com:acme-org/widgets.git",
  "github.com:acme-org/widgets",
  "ssh://git@github.com/acme-org/widgets.git",
  "ssh://git@github.com:2222/acme-org/widgets",
  "git://github.com/acme-org/widgets.git",
  "HTTPS://GitHub.com/acme-org/widgets",
  "  https://github.com/acme-org/widgets.git\n",
])("%j names the repository by its host and path", (address) => {
  expect(setupRepositoryRead(address)).toEqual({ said, key: said });
});

/** Addresses that carry a credential, each with the secret it must not keep. */
const credentialed: readonly (readonly [string, string])[] = [
  ["https://person:hunter2@github.com/acme-org/widgets.git", "hunter2"],
  ["https://ghp_s3cr3tT0k3n@github.com/acme-org/widgets", "ghp_s3cr3tT0k3n"],
  [
    "https://x-access-token:ghs_s3cr3t@github.com/acme-org/widgets.git",
    "ghs_s3cr3t",
  ],
  ["ssh://deploy:hunter2@github.com:22/acme-org/widgets.git", "hunter2"],
  ["https://github.com/acme-org/widgets?token=hunter2", "hunter2"],
  ["https://github.com/acme-org/widgets.git#hunter2", "hunter2"],
  ["hunter2@github.com:acme-org/widgets.git", "hunter2"],
];

test.each(credentialed)(
  "%j is kept as its host and path, and nothing of what came before the host or after the path",
  (address, secret) => {
    const read = setupRepositoryRead(address);
    expect(read).toEqual({ said, key: said });
    expect(JSON.stringify(read)).not.toContain(secret);
  },
);

test("the same repository is the same key however its address is cased, and is said as it was written", () => {
  expect(setupRepositoryRead("git@GitHub.com:Acme-Org/Widgets.git")).toEqual({
    said: "github.com/Acme-Org/Widgets",
    key: said,
  });
});

test.each([
  "",
  "   ",
  "/home/person/widgets.git",
  "../widgets",
  "widgets",
  "file:///home/person/widgets",
  "C:\\work\\widgets",
  "ftp://github.com/acme-org/widgets",
  "https://",
  "https://github.com",
  "https://github.com/",
  "github.com:",
  "person:hunter2@github.com:acme-org/widgets",
  "https://github.com/person:hunter2@acme-org/widgets",
  "github.com:hunter2@acme-org/widgets",
  "https://github.com/acme-org/widgets and more",
  "fatal: not a git repository",
])("%j is no remote", (address) => {
  expect(setupRepositoryRead(address)).toBeUndefined();
});

function asking(printed: string | undefined): {
  readonly process: SetupProcessPort;
  readonly asked: unknown[][];
} {
  const asked: unknown[][] = [];
  const refused = (): never => {
    throw new Error("the remote is read and nothing else is run");
  };
  return {
    asked,
    process: {
      pid: 1,
      alive: refused,
      detach: refused,
      launch: refused,
      read: (...given) => {
        asked.push(given);
        return Promise.resolve(printed);
      },
    },
  };
}

test("git is asked once for the address of origin, for a bounded time and a bounded answer, and nothing else is run", async () => {
  const { process, asked } = asking(`https://github.com/acme-org/widgets\n`);
  expect(await setupRemoteRead(process)).toEqual({ said, key: said });
  expect(asked).toEqual([
    [["git", "remote", "get-url", "origin"], 5_000, 4_096],
  ]);
  expect([setupRemoteCommand, setupRemoteWaitMs, setupRemoteBytesMax]).toEqual(
    asked[0],
  );
});

test("where git printed nothing that could be read, or no address, the folder has no remote", async () => {
  expect(await setupRemoteRead(asking(undefined).process)).toBeUndefined();
  expect(await setupRemoteRead(asking("").process)).toBeUndefined();
  expect(
    await setupRemoteRead(asking("/srv/git/widgets.git\n").process),
  ).toBeUndefined();
});
