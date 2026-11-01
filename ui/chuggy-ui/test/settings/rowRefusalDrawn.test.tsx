/**
 * A refusal a settings list draws in the row it names is the list's while that
 * row is drawn, and the shell's toast once a reread has taken the row away
 * before the refusal landed, the reread the refusal itself starts as much as
 * any other: an invite link's revocation, and a permission's removal.
 */

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import { SessionProvider } from "../../app/browser/session.tsx";
import {
  InviteLinksListing,
  inviteLinkRevocationWrite,
} from "../../app/browser/settings/InviteLinksListing.tsx";
import type { InviteLinkListed } from "../../app/browser/settings/InviteLinksListing.tsx";
import { PermissionsSection } from "../../app/browser/settings/PermissionsSection.tsx";
import type { PermissionHolderPressed } from "../../app/browser/settings/PermissionAddition.tsx";
import {
  ConsoleWriteRefused,
  consoleQueryClient,
  consoleWriteKey,
  consoleWriteWatchOf,
} from "../../app/core/consoleWrite.ts";
import type { ConsoleWrite } from "../../app/core/consoleWrite.ts";
import type { PanelState } from "../../app/core/freshness.ts";
import type { PermissionRow } from "../../app/core/permissions.ts";
import { holderDouble, settled, turned } from "../screenHarness.tsx";

afterEach(cleanup);

const refusedSentence = "Refused · not yours to change";

/** A write held until the case refuses it. */
function heldRefusal<V>(named: string): {
  readonly write: ConsoleWrite<V, undefined>;
  readonly refuse: () => void;
} {
  let refuse: () => void = () => undefined;
  const refusing = new Promise<never>((_, reject) => {
    refuse = () => {
      reject(new ConsoleWriteRefused(refusedSentence));
    };
  });
  return {
    write: {
      mutationKey: consoleWriteKey(named),
      write: () => refusing,
      refusal: () => refusedSentence,
    },
    refuse: () => {
      refuse();
    },
  };
}

/** The children over `client`, drawn again by the hand this answers. */
function drawnOver(
  client: QueryClient,
  children: ReactNode,
): (again: ReactNode) => Promise<void> {
  const tree = (drawn: ReactNode): ReactNode => (
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={client}>{drawn}</QueryClientProvider>
    </SessionProvider>
  );
  const view = render(tree(children));
  return async (again) => {
    await turned(() => {
      view.rerender(tree(again));
    });
    await settled();
  };
}

function unseen(client: QueryClient): readonly string[] {
  return consoleWriteWatchOf(client).unseen.map((refused) => refused.sentence);
}

function linkOf(link: string): InviteLinkListed {
  return {
    link,
    state: "Open",
    mintedBy: { subject: "s-ada", account: false },
    mintedAtMs: 0,
    expiresAtMs: 0,
  };
}

function links(
  listed: readonly InviteLinkListed[],
  revocation: ConsoleWrite<string, undefined>,
): ReactNode {
  return (
    <InviteLinksListing
      links={listed}
      first={{ heading: "Access", cell: (link) => link.link }}
      third={{ heading: "Used by", cell: () => undefined }}
      revocable={(link) => link.link === "l-one"}
      revocation={revocation}
    />
  );
}

/** Revoke pressed and confirmed on the link `l-one`, its answer held. */
async function revoking(
  client: QueryClient,
  revocation: ConsoleWrite<string, undefined>,
): Promise<(again: ReactNode) => Promise<void>> {
  const redrawn = drawnOver(
    client,
    links([linkOf("l-one"), linkOf("l-two")], revocation),
  );
  await settled();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("group", { name: "Revoke link" })).getByRole(
        "button",
        { name: "Revoke" },
      ),
    );
  });
  return redrawn;
}

test("a revocation refused while its row is drawn is said under the row, and no toast", async () => {
  const client = consoleQueryClient();
  const held = heldRefusal<string>("revoke-drawn");
  await revoking(client, held.write);

  await turned(held.refuse);
  await settled();

  expect(screen.getByText(refusedSentence)).toBeDefined();
  expect(unseen(client)).toEqual([]);
});

test("a revocation refused once a reread took its row away is the shell's toast", async () => {
  const client = consoleQueryClient();
  const held = heldRefusal<string>("revoke-gone");
  const redrawn = await revoking(client, held.write);
  await redrawn(links([linkOf("l-two")], held.write));

  await turned(held.refuse);
  await settled();

  expect(screen.queryByText(refusedSentence)).toBeNull();
  expect(unseen(client)).toEqual([refusedSentence]);
});

const linksKey = ["revoke-reread-links"];

/** What the links read answers, once `answered` has. */
interface LinksHeld {
  links: InviteLinkListed[];
  answered: Promise<void>;
}

/** The listing over a read of `held`, revoked by the real write, whose
 * revocation is refused `Absent` and ends `l-one`, holding the reread until
 * the hand this answers releases it. */
function linksRead(client: QueryClient, held: LinksHeld): () => void {
  let release: () => void = () => undefined;
  function LinksRead(): ReactNode {
    const read = useQuery({
      queryKey: linksKey,
      queryFn: () => held.answered.then(() => held.links),
    });
    return links(
      read.data ?? [],
      inviteLinkRevocationWrite(
        ["revoke-reread"],
        () => {
          held.links = held.links.filter((link) => link.link !== "l-one");
          held.answered = new Promise((resolve) => {
            release = resolve;
          });
          return Promise.resolve({ outcome: "Absent" });
        },
        (client) => client.invalidateQueries({ queryKey: linksKey }),
      ),
    );
  }
  drawnOver(client, <LinksRead />);
  return () => {
    release();
  };
}

test("a revocation refused whose own reread takes its row away is the shell's toast once that reread is drawn", async () => {
  const client = consoleQueryClient();
  const release = linksRead(client, {
    links: [linkOf("l-one"), linkOf("l-two")],
    answered: Promise.resolve(),
  });
  await settled();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  });
  await turned(() => {
    fireEvent.click(
      within(screen.getByRole("group", { name: "Revoke link" })).getByRole(
        "button",
        { name: "Revoke" },
      ),
    );
  });
  await settled();
  expect(screen.getByText("l-one")).toBeDefined();
  expect(unseen(client)).toEqual([]);

  await turned(release);
  await settled();

  expect(screen.queryByText("l-one")).toBeNull();
  expect(screen.queryByText("Not available")).toBeNull();
  expect(unseen(client)).toEqual(["Not available"]);
});

const developers: PermissionRow<"DeveloperGranters"> = {
  authority: "DeveloperGranters",
  name: "Grant Developer",
  holders: [
    {
      kind: "Person",
      person: { subject: "s-ada", mine: false },
      words: "s-ada",
    },
  ],
};

function permissions(
  read: PanelState<{ readonly truncated: boolean }>,
  write: ConsoleWrite<PermissionHolderPressed<"DeveloperGranters">, undefined>,
): ReactNode {
  return (
    <PermissionsSection
      label="Project permissions"
      read={read}
      rows={() => [developers]}
      withheld="Not yours to read"
      removal={{ removable: () => true, write }}
      addition={{
        addable: () => false,
        choices: () => [],
        people: () => [],
        write: () => write,
      }}
    />
  );
}

const readReady: PanelState<{ readonly truncated: boolean }> = {
  state: "Ready",
  value: { truncated: false },
  observedAtMs: 0,
};

/** The one holder's removal pressed, its answer held. */
async function removing(
  client: QueryClient,
  write: ConsoleWrite<PermissionHolderPressed<"DeveloperGranters">, undefined>,
): Promise<(again: ReactNode) => Promise<void>> {
  const redrawn = drawnOver(client, permissions(readReady, write));
  await settled();
  await turned(() => {
    fireEvent.click(
      screen.getByRole("button", { name: "Remove s-ada from Grant Developer" }),
    );
  });
  return redrawn;
}

test("a removal refused while its row is drawn is said in the row, and no toast", async () => {
  const client = consoleQueryClient();
  const held =
    heldRefusal<PermissionHolderPressed<"DeveloperGranters">>("remove-drawn");
  await removing(client, held.write);

  await turned(held.refuse);
  await settled();

  expect(screen.getByText(refusedSentence)).toBeDefined();
  expect(unseen(client)).toEqual([]);
});

test("a removal refused once a reread withheld the list is the shell's toast", async () => {
  const client = consoleQueryClient();
  const held =
    heldRefusal<PermissionHolderPressed<"DeveloperGranters">>("remove-gone");
  const redrawn = await removing(client, held.write);
  await redrawn(
    permissions({ state: "Absent", reason: "withheld" }, held.write),
  );

  await turned(held.refuse);
  await settled();

  expect(screen.queryByText(refusedSentence)).toBeNull();
  expect(unseen(client)).toEqual([refusedSentence]);
});
