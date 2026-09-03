/**
 * The three inquiry routes over a real database, through the ports the ROOT
 * composes: the API's own role, 063's definers, and the HTTP boundary above
 * them.
 *
 * WHAT A DOUBLE CANNOT ANSWER. `test/adapters/httpLeadInquiries.test.ts`
 * settles the transport against a fake boundary and
 * `test/postgres/inquiryDurable.test.ts` settles the definers against a real
 * server; neither can say the two were ever joined. #530's own history is the
 * argument: until its doors suite there was no case in which
 * `NativeThreadPorts` was composed at all, so every thread route raised in a
 * deployment while every gate stayed green.
 *
 * NO ROUTE HERE MAY ANSWER `500`, and that is the assertion each case leads
 * with rather than a shape it happens to imply. `composeNativeWeb` is what the
 * root calls, and it falls back to the API pool's own inquiry store, so a
 * bundle nobody passed is still a bundle — `nativeInquiryPorts` is the root's
 * own naming of the same thing, and `test/roots/nativeHttp.test.ts` observes
 * which pool it reached.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  inquiriesOpenPerMemberMax,
  inquiryQuestionCharsMax,
  nativeHttpMediaType,
} from "../../src/contract/http.ts";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
} from "../../src/contract/responses.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresProjectAccess } from "../../src/adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessKeying } from "./harness.ts";
import {
  inquiryRigLead,
  inquiryRigMember,
  inquiryRigOpen,
  inquiryRigProject,
  type InquiryRig,
  type InquiryRigMember,
} from "./inquiryHarness.ts";
import { threadRigIssuer, threadRigRevoke } from "./threadHarness.ts";

let rig: InquiryRig;

before(async () => {
  rig = await inquiryRigOpen();
});

after(async () => {
  await rig.close();
});

const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };

/**
 * The app the routes are driven through. It names NO inquiry bundle, because
 * what this suite has to hold is that a caller who names none still reaches the
 * database: the fallback inside `composeNativeWeb` is the control, and a
 * deployment that forgets the port is the failure it prevents.
 */
function inquiryApp(principal: Principal) {
  const pool = rig.apiPool;
  return createNativeHttpApp(
    composeNativeWeb(
      pool,
      postgresHarnessKeying(),
      postgresProjectAccess(pool),
      postgresExecutionBacklogGuard(pool),
    ),
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}/lead/inquiries`;
}

/** A project whose lead has run, and a member of it no other case is holding. */
async function askableProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: InquiryRigMember;
}> {
  const partition = await inquiryRigProject(rig, `http-${label}`);
  await inquiryRigLead(rig, partition, `http-${label}`);
  const member = await inquiryRigMember(rig, partition, `http-${label}`);
  assert.equal(
    member.principal,
    oidcPrincipal(threadRigIssuer, member.authority.subject),
    "the principal the app authenticates as is the membership's own",
  );
  return { partition, member };
}

/** One question through the door, refusing anything but the fork it accepted. */
async function asked(
  app: ReturnType<typeof inquiryApp>,
  partition: Partition,
  question = "what stopped ticket 14?",
) {
  const session = `inq-http-${randomUUID()}`;
  const accepted = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: { session, turn: `inq-turn-http-${randomUUID()}`, question },
  });
  assert.notEqual(accepted.statusCode, 500, accepted.body);
  assert.equal(accepted.statusCode, 202, accepted.body);
  return leadInquiryAcceptedSchema.parse(accepted.json());
}

test("asking through the composed root opens a fork the database holds", async () => {
  const { partition, member } = await askableProject("ask");
  await using app = inquiryApp(member.principal);

  const accepted = await asked(app, partition);
  assert.equal(accepted.ordinal, 1);

  const held = await rig.sessions.harness.query(
    `SELECT kind,principal,parent_session IS NOT NULL AS forked
       FROM agent_session WHERE session=$1`,
    [accepted.session],
  );
  assert.deepEqual(held, [
    { kind: "Inquiry", principal: member.principal, forked: true },
  ]);
});

test("the listing answers what the database holds, mine marked and the asker named", async () => {
  const { partition, member } = await askableProject("list");
  const other = await inquiryRigMember(rig, partition, "http-list-other");
  await using mine = inquiryApp(member.principal);
  await using theirs = inquiryApp(other.principal);

  const first = await asked(mine, partition, "mine");
  const second = await asked(theirs, partition, "theirs");

  const listed = await mine.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.notEqual(listed.statusCode, 500, listed.body);
  assert.equal(listed.statusCode, 200);
  const page = leadInquiriesResponseSchema.parse(listed.json());
  assert.deepEqual(
    page.inquiries.map(({ session, question, asker, mine: own }) => ({
      session,
      question,
      asker,
      own,
    })),
    [
      {
        session: second.session,
        question: "theirs",
        asker: other.authority.subject,
        own: false,
      },
      {
        session: first.session,
        question: "mine",
        asker: member.authority.subject,
        own: true,
      },
    ],
  );
});

test("one inquiry is answered on its own route, and an absent one is not found", async () => {
  const { partition, member } = await askableProject("one");
  await using app = inquiryApp(member.principal);
  const accepted = await asked(app, partition);

  const one = await app.inject({
    url: `${pathOf(partition)}/${accepted.session}`,
    headers: authorized,
  });
  assert.notEqual(one.statusCode, 500, one.body);
  assert.equal(one.statusCode, 200);
  assert.equal(
    leadInquiryResponseSchema.parse(one.json()).session,
    accepted.session,
  );

  const absent = await app.inject({
    url: `${pathOf(partition)}/inq-nobody-opened`,
    headers: authorized,
  });
  assert.equal(absent.statusCode, 404, absent.body);
});

/**
 * Every refusal the door can meet, reached through the composed root rather
 * than through a boundary that was told to answer it: a status this suite sees
 * is one a deployment would send.
 */
test("each refusal the door meets is the status the wire sends", async () => {
  const leadless = await inquiryRigProject(rig, "http-leadless");
  const nobody = await inquiryRigMember(rig, leadless, "http-leadless");
  await using none = inquiryApp(nobody.principal);
  const noLead = await none.inject({
    method: "POST",
    url: pathOf(leadless),
    headers: versioned,
    payload: {
      session: `inq-http-${randomUUID()}`,
      turn: `inq-turn-http-${randomUUID()}`,
      question: "anybody there?",
    },
  });
  assert.equal(noLead.statusCode, 404, noLead.body);

  const { partition, member } = await askableProject("refusals");
  await using app = inquiryApp(member.principal);
  for (let spent = 0; spent < inquiriesOpenPerMemberMax; spent += 1)
    await asked(app, partition, `spending ${String(spent)}`);
  const inFlight = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {
      session: `inq-http-${randomUUID()}`,
      turn: `inq-turn-http-${randomUUID()}`,
      question: "one too many",
    },
  });
  assert.equal(inFlight.statusCode, 409, inFlight.body);
  assert.equal(
    inFlight.json<HttpErrorEnvelope>().error.code,
    "InquiriesInFlight",
  );
  assert.equal(
    inFlight.headers["retry-after"],
    undefined,
    "a bound only the asker can clear told them to come back on a clock",
  );
});

/** A caller with no membership at all reads nothing, which is what gates every route. */
test("a project the caller is not a member of answers nothing on any route", async () => {
  const { partition } = await askableProject("gated");
  await using app = inquiryApp(
    oidcPrincipal(threadRigIssuer, `stranger-${randomUUID()}`),
  );

  for (const url of [pathOf(partition), `${pathOf(partition)}/inq-absent`]) {
    const refused = await app.inject({ url, headers: authorized });
    assert.equal(refused.statusCode, 404, url);
  }
  const asking = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {
      session: `inq-http-${randomUUID()}`,
      turn: `inq-turn-http-${randomUUID()}`,
      question: "let me in",
    },
  });
  assert.equal(asking.statusCode, 404, asking.body);
});

/** The bound the door checks before anything reaches a definer. */
test("a question over the door's own bound never reaches the database", async () => {
  const { partition, member } = await askableProject("bound");
  await using app = inquiryApp(member.principal);

  const refused = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {
      session: `inq-http-${randomUUID()}`,
      turn: `inq-turn-http-${randomUUID()}`,
      question: "q".repeat(inquiryQuestionCharsMax + 1),
    },
  });
  assert.equal(refused.statusCode, 400, refused.body);

  const listed = await app.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.deepEqual(
    leadInquiriesResponseSchema.parse(listed.json()).inquiries,
    [],
  );
});

/**
 * A member who asked and then lost their membership is still listed, with no
 * asker — slice 4's `Orphaned` argument over the wire rather than over a row.
 */
test("an inquiry whose asker's membership is gone is answered with no asker", async () => {
  const { partition, member } = await askableProject("orphaned");
  const reader = await inquiryRigMember(rig, partition, "http-orphaned-reader");
  await using asking = inquiryApp(member.principal);
  const accepted = await asked(asking, partition);
  await threadRigRevoke(rig, partition, member);

  await using app = inquiryApp(reader.principal);
  const listed = await app.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const page = leadInquiriesResponseSchema.parse(listed.json());
  assert.deepEqual(
    page.inquiries.map(({ session, asker }) => ({ session, asker })),
    [{ session: accepted.session, asker: undefined }],
  );
});
