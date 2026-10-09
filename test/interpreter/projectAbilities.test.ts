/**
 * The abilities read: which of a project's doors its reader may press, each by
 * the kind that door asks.
 *
 * THE CASE WITHOUT `Read` IS THE ONE WITH TEETH. The in-memory access holds
 * each kind on its own, so a read whose gate was dropped would answer a caller
 * holding every other kind all `true` rather than `NotFound`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectAbilitiesResponse } from "../../src/contract/responses.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import {
  ProjectAccessUnavailable,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "./nativeWebFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const member = asPrincipal("issuer-member");

const none: ProjectAbilitiesResponse = {
  mutate: false,
  dispatch: false,
  manageSelector: false,
  administer: false,
};

/** Each field and the kind its door asks, written out rather than read from the interpreter's record. */
const asked: readonly (readonly [
  keyof ProjectAbilitiesResponse,
  ProjectAccessKind,
])[] = [
  ["mutate", "Mutate"],
  ["dispatch", "DispatchTicket"],
  ["manageSelector", "ManageProjectSelector"],
  ["administer", "Administer"],
];

function boundary(kinds: readonly ProjectAccessKind[]) {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: member, access: new Set(kinds) });
  return { access, web: nativeWeb(access, ...unaskedNativeWebPorts) };
}

test("a caller holding Read alone may press none of the doors", async () => {
  const { web } = boundary(["Read"]);

  assert.deepEqual(await web.abilities(member, partition), {
    result: "Authorized",
    value: none,
  });
});

test("each kind a caller holds opens its own field and no other", async () => {
  for (const [field, kind] of asked) {
    const { web } = boundary(["Read", kind]);

    assert.deepEqual(
      await web.abilities(member, partition),
      { result: "Authorized", value: { ...none, [field]: true } },
      kind,
    );
  }
});

test("a caller who may not read the project is not found, whatever else they hold", async () => {
  const { web } = boundary(asked.map(([, kind]) => kind));

  assert.deepEqual(await web.abilities(member, partition), {
    result: "NotFound",
  });
});

/** `Read` answers, so the outage the case sees is the ability's own and not the gate's in front of it. */
test("one kind the authority cannot answer is an outage, never a false", async () => {
  const { access } = boundary(["Read", "Mutate", "Administer"]);
  const web = nativeWeb(
    {
      ...access,
      authorize: (principal, partition, kind) =>
        kind === "DispatchTicket"
          ? Promise.reject(new ProjectAccessUnavailable("dispatch is down"))
          : access.authorize(principal, partition, kind),
    },
    ...unaskedNativeWebPorts,
  );

  await assert.rejects(
    web.abilities(member, partition),
    ProjectAccessUnavailable,
  );
});
