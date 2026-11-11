/**
 * The three inquiry routes over a real database, through the ports the ROOT
 * composes: the API's own role, the inquiry definers, and the HTTP boundary
 * above them.
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
 * root calls and it composes the inquiry store itself rather than taking one,
 * so there is no boundary these routes can be missing from;
 * `test/roots/nativeHttp.test.ts` observes which pool that composition reached.
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
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { selectorServiceRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresSessionPlacement,
  postgresSubsidizedLeadPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { SubsidizedLeadOffer } from "../../src/interpreter/sessionPlacement.ts";
import { postgresHarnessKeying, postgresHarnessRolePool } from "./harness.ts";
import {
  inquiryRigLead,
  inquiryRigMember,
  inquiryRigOpen,
  inquiryRigProject,
  type InquiryRigRunOpening,
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
 * The app the routes are driven through, composed the way the root composes it
 * and passing no inquiry port because there is none to pass. What this suite
 * holds is that the routes reach the database anyway, which is what makes a
 * deployment unable to forget them.
 */
function inquiryApp(principal: Principal) {
  const pool = rig.apiPool;
  return createNativeHttpApp(
    composeNativeWeb(
      pool,
      postgresHarnessKeying(),
      rig.sessions.harness.access,
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
  const member = inquiryRigMember(rig, partition, `http-${label}`);
  assert.equal(
    member.principal,
    member.authority.subject,
    "the principal the app authenticates as is the authority it is audited to",
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
  const other = inquiryRigMember(rig, partition, "http-list-other");
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
  const nobody = inquiryRigMember(rig, leadless, "http-leadless");
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

/**
 * Asking starts a turn, so a member who may read the project and not change it
 * is answered the `404` a caller outside it is, and still reads the listing.
 */
test("a member holding Read and not Mutate reads the listing and cannot ask", async () => {
  const { partition } = await askableProject("reader");
  const reader = inquiryRigMember(
    rig,
    partition,
    "http-reader",
    new Set(["Read"] as const),
  );
  await using app = inquiryApp(reader.principal);

  const asking = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {
      session: `inq-http-${randomUUID()}`,
      turn: `inq-turn-http-${randomUUID()}`,
      question: "may I?",
    },
  });
  assert.equal(asking.statusCode, 404, asking.body);

  const listed = await app.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(
    leadInquiriesResponseSchema.parse(listed.json()).inquiries,
    [],
  );
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
  const reader = inquiryRigMember(rig, partition, "http-orphaned-reader");
  await using asking = inquiryApp(member.principal);
  const accepted = await asked(asking, partition);
  threadRigRevoke(rig, partition, member);

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

const subsidy: SubsidizedLeadOffer = {
  credentialSlot: "anthropic-api",
  model: "claude-haiku-5-5",
  effort: "medium",
  autoCompactWindow: 100_000,
  inputBytesPerDecision: 65_536,
  turnTokensMax: 200_000,
  tenantMonthlyMicros: 5_000_000,
  deploymentMonthlyMicros: 50_000_000,
  unmeasuredTurnMicros: 100_000,
};

/** Publishes `published` as the selector does as it starts, or withdraws it. */
async function subsidyPublished(
  published: SubsidizedLeadOffer | undefined,
): Promise<void> {
  const selector = postgresHarnessRolePool(selectorServiceRole);
  try {
    assert.deepEqual(
      await postgresSubsidizedLeadPrecondition(selector, published).check(
        new AbortController().signal,
      ),
      { met: "Met" },
    );
  } finally {
    await selector.end();
  }
}

/** The slot, model, effort and own system prompt a lead opened on the profile stands on. */
const onTheProfile: InquiryRigRunOpening = {
  credentialSlot: subsidy.credentialSlot,
  model: subsidy.model,
  effort: subsidy.effort,
  systemPromptOwn: true,
};

/** A project storing a subsidized lead whose lead stands as `standing` opens it, and a member the tenant grants no hosted runs. */
async function subsidizedProject(
  label: string,
  standing: InquiryRigRunOpening = {},
) {
  const partition = await inquiryRigProject(rig, `http-${label}`);
  await inquiryRigLead(rig, partition, `http-${label}`, standing);
  assert.equal(
    await postgresSessionPlacement(rig.apiPool).write(
      partition,
      { Thread: "InCluster", Lead: "InCluster", leadOffering: "Subsidized" },
      {
        kind: asAuthorityKind("Member"),
        subject: asAuthoritySubject("an-owner"),
      },
    ),
    "Written",
  );
  const principal = oidcPrincipal(
    threadRigIssuer,
    `member-http-${label}-${randomUUID()}`,
  );
  rig.sessions.harness.access.grant({
    partition,
    principal,
    access: new Set(["Read", "Mutate"]),
  });
  return { partition, principal };
}

/** The credential slot of every fork `partition`'s lead has. */
function forkSlots(partition: Partition) {
  return rig.sessions.harness.query(
    `SELECT credential_slot FROM agent_session
      WHERE tenant=$1 AND project=$2 AND kind='Inquiry'`,
    [partition.tenant, partition.project],
  );
}

/**
 * The subsidy pays for an inquiry only on its own slot, and a lead opened
 * before its project chose it stands on the hosted one until it is replaced.
 */
test("a member the tenant grants no hosted runs asks a subsidized lead only where it stands on the profile's slot", async () => {
  await subsidyPublished(subsidy);
  try {
    const standing = await subsidizedProject("subsidy-standing");
    await using refusing = inquiryApp(standing.principal);
    const refused = await refusing.inject({
      method: "POST",
      url: pathOf(standing.partition),
      headers: versioned,
      payload: {
        session: `inq-http-${randomUUID()}`,
        turn: `inq-turn-http-${randomUUID()}`,
        question: "who pays for this?",
      },
    });
    assert.equal(refused.statusCode, 403, refused.body);
    assert.deepEqual(
      await forkSlots(standing.partition),
      [],
      "a lead on the hosted slot was forked on the subsidy",
    );

    const replaced = await subsidizedProject("subsidy-replaced", onTheProfile);
    await using app = inquiryApp(replaced.principal);
    await asked(app, replaced.partition, "who pays for this?");
    assert.deepEqual(await forkSlots(replaced.partition), [
      { credential_slot: subsidy.credentialSlot },
    ]);
  } finally {
    await subsidyPublished(undefined);
  }
});

/**
 * The subsidy pays for the profile's model and effort, not only its slot, and a
 * lead opened before the profile last changed them stands on the old ones until
 * it is replaced.
 */
test("a member the tenant grants no hosted runs asks a subsidized lead only where it stands on the profile's model and effort", async () => {
  await subsidyPublished(subsidy);
  try {
    for (const [label, standing] of [
      ["subsidy-old-model", { ...onTheProfile, model: "claude-opus-5-5" }],
      ["subsidy-old-effort", { ...onTheProfile, effort: "high" }],
    ] as const) {
      const project = await subsidizedProject(label, standing);
      await using app = inquiryApp(project.principal);
      const refused = await app.inject({
        method: "POST",
        url: pathOf(project.partition),
        headers: versioned,
        payload: {
          session: `inq-http-${randomUUID()}`,
          turn: `inq-turn-http-${randomUUID()}`,
          question: "who pays for this?",
        },
      });
      assert.equal(refused.statusCode, 403, `${label}: ${refused.body}`);
      assert.deepEqual(
        await forkSlots(project.partition),
        [],
        `${label}: a lead off the profile was forked on the subsidy`,
      );
    }
  } finally {
    await subsidyPublished(undefined);
  }
});

/**
 * A lead stored before a session held its own system prompt reads it unset, and
 * may already stand on the profile's slot, model and effort. Forked on the
 * subsidy, it would load its project's settings beside the profile's slot.
 */
test("a subsidized inquiry forks only a lead on its own system prompt", async () => {
  await subsidyPublished(subsidy);
  try {
    const project = await subsidizedProject("subsidy-prompt-not-own", {
      ...onTheProfile,
      systemPromptOwn: false,
    });
    await using app = inquiryApp(project.principal);
    const refused = await app.inject({
      method: "POST",
      url: pathOf(project.partition),
      headers: versioned,
      payload: {
        session: `inq-http-${randomUUID()}`,
        turn: `inq-turn-http-${randomUUID()}`,
        question: "who pays for this?",
      },
    });
    assert.equal(refused.statusCode, 403, refused.body);
    assert.deepEqual(
      await forkSlots(project.partition),
      [],
      "a lead on its project's settings was forked on the subsidy",
    );
  } finally {
    await subsidyPublished(undefined);
  }
});

/**
 * The subsidy is a way in for a member without the grant, never a refusal of
 * one with it: a lead still on the hosted slot is asked on the member's grant.
 */
test("a member the tenant grants hosted runs asks a subsidized lead still on the hosted slot", async () => {
  await subsidyPublished(subsidy);
  try {
    const { partition } = await subsidizedProject("subsidy-granted");
    const member = inquiryRigMember(rig, partition, "http-subsidy-granted");
    await using app = inquiryApp(member.principal);
    await asked(app, partition, "who pays for this?");
    assert.equal((await forkSlots(partition)).length, 1);
  } finally {
    await subsidyPublished(undefined);
  }
});

/**
 * The subsidy's cap bounds an inquiry's admission as it does the lead's: the
 * fork's spend counts toward its tenant's month, and once that reaches the cap
 * the door opens no fork, so a refused inquiry spends nothing.
 */
test("an inquiry's spend counts toward its tenant's month, and one asked past the cap is refused SubsidyExhausted and opens no fork", async () => {
  await subsidyPublished({ ...subsidy, tenantMonthlyMicros: 1_000 });
  try {
    const capped = await subsidizedProject("subsidy-capped", onTheProfile);
    await using app = inquiryApp(capped.principal);
    const accepted = await asked(app, capped.partition, "who pays for this?");
    await rig.sessions.harness.query(
      `UPDATE session_turn
          SET state='Answered',result='answered',ended_at=now(),
              model=$4,tokens=1,cost_micros=1000,duration_ms=1,tools='{}'
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [
        capped.partition.tenant,
        capped.partition.project,
        accepted.session,
        subsidy.model,
      ],
    );
    const refused = await app.inject({
      method: "POST",
      url: pathOf(capped.partition),
      headers: versioned,
      payload: {
        session: `inq-http-${randomUUID()}`,
        turn: `inq-turn-http-${randomUUID()}`,
        question: "and now?",
      },
    });
    assert.equal(refused.statusCode, 403, refused.body);
    assert.equal(
      refused.json<{ error: { code: string } }>().error.code,
      "SubsidyExhausted",
    );
    assert.equal(
      (await forkSlots(capped.partition)).length,
      1,
      "an inquiry past the cap opened a fork",
    );
  } finally {
    await subsidyPublished(undefined);
  }
});
