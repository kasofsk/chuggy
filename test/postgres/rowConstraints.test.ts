/**
 * Rows the installed schema refuses by its own constraints and triggers, each
 * written directly rather than through a door, so that no door declining to
 * write one is what holds the refusal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configurationCpusMax,
  configurationMemoryMibMax,
  configurationMemoryMibMin,
} from "../../src/contract/configurationDocument.ts";
import { configurationCanonicalCharsMax } from "../../src/contract/http.ts";
import { workerImageFaults } from "../../src/contract/workerEnvironment.ts";
import { workerImageCharsMax } from "../../src/contract/workerPool.ts";
import type pg from "pg";
import {
  deletionJournalRow,
  deletionPartition,
  identityExecution,
  journalledRevocation,
  migratedDatabase,
  releasedSeeded,
} from "./migrationHarness.ts";

test("a pool names the one class a registered pool has, and no default names it", async () => {
  await migratedDatabase("pool_class", async (subject) => {
    await subject.query(deletionPartition);
    const registered = (pool: string, named: string) =>
      subject.query(
        `INSERT INTO worker_pool(tenant,project,pool,class,principal,client_id)
         VALUES('tenant-5','project-5',$1,$2,$1,$1)`,
        [pool, named],
      );
    for (const refused of ["Personal", "Shared"])
      await assert.rejects(
        registered(refused, refused),
        /worker_pool_class_is_known/u,
        refused,
      );
    assert.equal((await registered("dedicated", "Dedicated")).rowCount, 1);
    await assert.rejects(
      subject.query(
        `INSERT INTO worker_pool(tenant,project,pool,principal,client_id)
         VALUES('tenant-5','project-5','defaulted','defaulted','defaulted')`,
      ),
      /null value in column "class"/u,
    );
  });
});

test("an attempt names the principal of the pool holding it, and none while no pool does", async () => {
  await migratedDatabase("pool_principal", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null),
    );
    for (const unpaired of [
      "pool='pool-5', assignment='assignment-5'",
      "pool_principal='principal-5'",
    ])
      await assert.rejects(
        subject.query(`UPDATE execution_attempt SET ${unpaired}`),
        /execution_attempt_pool_principal_is_a_pool_s/u,
        unpaired,
      );
    await subject.query(
      `UPDATE execution_attempt SET pool='pool-5', assignment='assignment-5',
              pool_principal='principal-5', capability_secret_digest=NULL`,
    );
  });
});

test("the installation's execution routing is one row, seeded to run every stage in cluster", async () => {
  await migratedDatabase("execution_routing", async (subject) => {
    assert.deepEqual(
      (
        await subject.query(
          "SELECT work_route, evaluation_route, project_routes FROM execution_routing",
        )
      ).rows,
      [
        {
          work_route: "InCluster",
          evaluation_route: "InCluster",
          project_routes: {},
        },
      ],
    );
    await assert.rejects(
      subject.query(`INSERT INTO execution_routing
        (singleton,work_route,evaluation_route,project_routes)
        VALUES (2,'Pool','Pool','{}')`),
      /execution_routing_is_one_row/u,
    );
  });
});

test("the installation's session routing is one row at most", async () => {
  await migratedDatabase("session_routing", async (subject) => {
    await assert.rejects(
      subject.query(`INSERT INTO session_routing
        (singleton,thread_route,lead_route,project_routes)
        VALUES (2,'Pool','Pool','{}')`),
      /session_routing_is_one_row/u,
    );
  });
});

test("a project's placement names who set it whole, or names nobody", async () => {
  await migratedDatabase("placement_setter", async (subject) => {
    await subject.query(`${deletionPartition}
      INSERT INTO project_execution_placement(tenant,project,work_route,evaluation_route)
      VALUES('tenant-5','project-5','InCluster','InCluster');
      INSERT INTO project_session_placement(tenant,project,thread_route,lead_route)
      VALUES('tenant-5','project-5','InCluster','InCluster')`);
    for (const placement of [
      "project_execution_placement",
      "project_session_placement",
    ])
      await assert.rejects(
        subject.query(`UPDATE ${placement} SET set_by_kind='Member'`),
        new RegExp(`${placement}_setter_is_whole`, "u"),
        placement,
      );
  });
});

/** A lead session of project-5, on a cluster account of its own. */
const sessionSeed = `${deletionPartition}
  INSERT INTO execution_cluster(cluster,slots_max,policy_revision)
  VALUES('cluster-5',1,1);
  INSERT INTO capacity_account(account,cluster,reserved,maximum,policy_revision)
  VALUES('account-5','cluster-5',0,1,1);
  INSERT INTO agent_session
    (tenant,project,session,kind,principal,capabilities,credential_slot,account,cluster)
  VALUES('tenant-5','project-5','session-5','Lead','principal-5','{}',
         'slot-5','account-5','cluster-5')`;

test("a turn is queued on the route a door stamped it with, and no default stamps one", async () => {
  await migratedDatabase("turn_route", async (subject) => {
    await subject.query(sessionSeed);
    await assert.rejects(
      subject.query(
        `INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input)
         VALUES('tenant-5','project-5','session-5','turn-5',1,'Observation','{}')`,
      ),
      /null value in column "route"/u,
    );
  });
});

test("a session attempt names a holder exactly when a runner holds it, only a holder there is, and never a member's runner while it runs", async () => {
  await migratedDatabase("session_holder", async (subject) => {
    await subject.query(`${sessionSeed};
      INSERT INTO session_attempt
        (tenant,project,session,attempt,attempt_number,recovery_epoch,bearer,bearer_secret_digest)
      VALUES('tenant-5','project-5','session-5','attempt-5',1,'epoch-5',
             'bearer-5',repeat('a',64))`);
    const held =
      "pool='pool-5', pool_principal='principal-5', assignment='assignment-5', image='image-5', launch='{}'";
    for (const [assignment, refusal] of [
      ["holder_kind='Pool'", "holder_is_runner_held"],
      [held, "holder_is_runner_held"],
      [`${held}, holder_kind='Runner'`, "holder_kind_is_known"],
      [`${held}, holder_kind='Personal'`, "personal_is_finished"],
    ] as const)
      await assert.rejects(
        subject.query(`UPDATE session_attempt SET ${assignment}`),
        new RegExp(`session_attempt_${refusal}`, "u"),
        assignment,
      );
    assert.equal(
      (
        await subject.query(
          `UPDATE session_attempt SET ${held}, holder_kind='Pool'`,
        )
      ).rowCount,
      1,
    );
  });
});

test("a project's session names a project there is", async () => {
  await migratedDatabase("session_project", async (subject) => {
    await subject.query(sessionSeed);
    await assert.rejects(
      subject.query(
        `INSERT INTO agent_session
           (tenant,project,session,kind,principal,capabilities,credential_slot,account,cluster)
         VALUES('tenant-5','project-6','session-6','Lead','principal-5','{}',
                'slot-5','account-5','cluster-5')`,
      ),
      /agent_session_belongs_to_project/u,
    );
  });
});

/** Writes one revision of a canonical that many characters long, answering the refusal where there is one. */
function revisionWritten(
  subject: pg.Pool,
  revision: string,
  chars: number,
): Promise<string | undefined> {
  return subject
    .query(
      `INSERT INTO configuration_revision
         (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
       VALUES('tenant-5','project-5',$1,$2,repeat('e',64),'User','subject-5')`,
      [revision, `"${"x".repeat(chars - 2)}"`],
    )
    .then(
      () => undefined,
      (failure: unknown) => String(failure),
    );
}

test("a configuration revision is as long as a configuration may be and no longer", async () => {
  await migratedDatabase("revision_length", async (subject) => {
    await subject.query(deletionPartition);
    assert.equal(
      await revisionWritten(
        subject,
        "at-limit",
        configurationCanonicalCharsMax,
      ),
      undefined,
    );
    assert.match(
      String(
        await revisionWritten(
          subject,
          "over-limit",
          configurationCanonicalCharsMax + 1,
        ),
      ),
      /configuration_revision_content_is_bounded/u,
    );
  });
});

test("a selector attempt is fenced at no negative project revision", async () => {
  await migratedDatabase("selector_attempt_revision", async (subject) => {
    await subject.query(deletionPartition);
    await assert.rejects(
      subject.query(
        `INSERT INTO selector_attempt(attempt,tenant,project,state,project_revision)
         VALUES('attempt-5','tenant-5','project-5','Running',-1)`,
      ),
      /selector_attempt_project_revision_check/u,
    );
  });
});

/** A link's insert, `extra` the columns past the ones every link names. */
function linkInsert(
  link: string,
  digest: string,
  extra: { readonly columns: string; readonly values: string },
): string {
  return `INSERT INTO invite_link(link,token_digest,new_accounts,minted_by,expires_at,${extra.columns})
    VALUES('${link}',repeat('${digest}',64),false,'minter',now()+interval '1 day',${extra.values})`;
}

test("a link is a tenant's, naming a role and its projects, or the site's, naming a workspace exactly when used", async () => {
  await migratedDatabase("link_kinds", async (subject) => {
    await subject.query(deletionPartition);
    for (const refused of [
      linkInsert("roled", "e", {
        columns: "create_accounts,role,projects",
        values: "true,'Member','[]'",
      }),
      linkInsert("accounting", "f", {
        columns: "tenant,role,projects,create_accounts",
        values: "'tenant-5','Member','[]',true",
      }),
      linkInsert("unnamed", "1", {
        columns: "create_accounts,used_by,used_at",
        values: "true,'user',now()",
      }),
    ])
      await assert.rejects(subject.query(refused), /invite_link_is_one_kind/u);
  });
});

test("an attempt admits exactly the image faults the contract names", async () => {
  await migratedDatabase("image_faults", async (subject) => {
    const known = (
      await subject.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
          WHERE c.conrelid = 'execution_attempt'::regclass
            AND c.conname = 'execution_attempt_pool_refusal_fault_is_known'`,
      )
    ).rows[0]?.definition;
    assert.deepEqual(
      [...(known ?? "").matchAll(/'([^']+)'::text/gu)].map((each) => each[1]),
      [...workerImageFaults],
    );
  });
});

/** Writes `assignment` over the one execution or attempt `relation` holds, answering the refusal where there is one. */
function rowWritten(
  subject: pg.Pool,
  relation: "execution" | "execution_attempt",
  assignment: string,
  value: string | number,
): Promise<string | undefined> {
  return subject.query(`UPDATE ${relation} SET ${assignment}=$1`, [value]).then(
    () => undefined,
    (failure: unknown) => String(failure),
  );
}

test("an attempt's runtime is named in at least one character and no more than an image's", async () => {
  await migratedDatabase("attempt_runtime", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null),
    );
    const written = (runtime: string) =>
      rowWritten(subject, "execution_attempt", "runtime", runtime);
    assert.equal(await written("r".repeat(workerImageCharsMax)), undefined);
    for (const runtime of ["", "r".repeat(workerImageCharsMax + 1)])
      assert.match(
        String(await written(runtime)),
        /execution_attempt_runtime_is_bounded/u,
        String(runtime.length),
      );
  });
});

test("a finished attempt completes its cleanup once and is written nothing else", async () => {
  await migratedDatabase("attempt_cleanup", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(`${identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null)};
      UPDATE execution_attempt SET state='Lost',evidence='LeaseExpired',ended_at=now()`);
    assert.equal(
      (
        await subject.query(
          "UPDATE execution_attempt SET cleanup_completed_at=now()",
        )
      ).rowCount,
      1,
    );
    for (const assignment of [
      "cleanup_completed_at=now()+interval '1 second'",
      "workload='moved'",
    ])
      await assert.rejects(
        subject.query(`UPDATE execution_attempt SET ${assignment}`),
        /a finished attempt is written once/u,
        assignment,
      );
  });
});

test("an execution is sized as a configuration may ask, and no larger or smaller", async () => {
  await migratedDatabase("execution_size", async (subject) => {
    await releasedSeeded(subject);
    await subject.query(
      identityExecution(1, "SpawnWork", "kind,cycle", "'Work',3", null),
    );
    const cpuMillisPerCpu = 1_000;
    for (const [column, least, most] of [
      ["cpu_millis", cpuMillisPerCpu, configurationCpusMax * cpuMillisPerCpu],
      ["memory_mib", configurationMemoryMibMin, configurationMemoryMibMax],
    ] as const) {
      const sized = (value: number) =>
        rowWritten(subject, "execution", column, value);
      assert.equal(await sized(least), undefined, column);
      assert.equal(await sized(most), undefined, column);
      for (const value of [least - 1, most + 1])
        assert.match(
          String(await sized(value)),
          new RegExp(`execution_${column}_is_bounded`, "u"),
          `${column} ${String(value)}`,
        );
    }
  });
});

test("a member's runner names its package and release in the header's grammar", async () => {
  await migratedDatabase("personal_runner_version", async (subject) => {
    await subject.query(`${deletionPartition}
      INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
      VALUES('tenant-5','owner-5','{}','principal-5','client-5')`);
    for (const [runnerPackage, version, refusal] of [
      ["chuggy_linux", "0.14.0", "runner_package_is_a_package"],
      ["chuggy-linux", "0.14.0-rc.1", "runner_version_is_a_release"],
      ["chuggy-linux", "0.014.0", "runner_version_is_a_release"],
    ] as const)
      await assert.rejects(
        subject.query(
          "UPDATE personal_runner SET runner_package=$1,runner_version=$2",
          [runnerPackage, version],
        ),
        new RegExp(`personal_runner_${refusal}`, "u"),
        `${runnerPackage}/${version}`,
      );
    assert.equal(
      (
        await subject.query(
          "UPDATE personal_runner SET runner_package='chuggy-linux',runner_version='0.14.0'",
        )
      ).rowCount,
      1,
    );
  });
});

test("a ticket's phase, a finalization's kind and a desk task's answer each refuse a name off their rosters", async () => {
  await migratedDatabase("ticket_rosters", async (subject) => {
    /**
     * The pairing trigger runs before the row is checked and refuses an
     * answer its task does not offer first, so it stands aside for the
     * constraint.
     */
    await subject.query(
      `ALTER TABLE native_action_resolution
       DISABLE TRIGGER native_action_resolution_pairs_with_its_kind`,
    );
    for (const [constraint, refused] of [
      [
        "ticket_projection_phase_is_known",
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq)
         VALUES('tenant-5','project-5',1,'Working',1)`,
      ],
      [
        "finalization_request_kind_is_known",
        `INSERT INTO finalization_request
           (tenant,project,request,authorizing_seq,effect_position,ticket,
            ticket_version,request_generation,kind,work_cycle,finalization_generation)
         VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'PromoteForHandoff',1,1)`,
      ],
      [
        "native_action_resolution_is_known",
        `INSERT INTO native_action_resolution(tenant,project,action,resolution)
         VALUES('tenant-5','project-5','action-5','RetryHandoff')`,
      ],
    ] as const)
      await assert.rejects(
        subject.query(refused),
        new RegExp(constraint, "u"),
        constraint,
      );
  });
});

test("a ticket's revision and a finalization's work cycle and generation are always named, wider than an integer", async () => {
  await migratedDatabase("ticket_counts", async (subject) => {
    await subject.query(
      `${deletionPartition}\n${deletionJournalRow(1, journalledRevocation)}`,
    );
    const wide = 2 ** 31;
    const projected = (ticket: number, revision: number | null) =>
      subject.query(
        `INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,revision)
         VALUES('tenant-5','project-5',$1,'Pending',1,$2)`,
        [ticket, revision],
      );
    const requested = (
      ticket: number,
      cycle: number | null,
      generation: number | null,
    ) =>
      subject.query(
        `INSERT INTO finalization_request
           (tenant,project,request,authorizing_seq,effect_position,ticket,
            ticket_version,request_generation,kind,work_cycle,finalization_generation)
         VALUES('tenant-5','project-5',$1,1,0,$2,1,1,'RunFinalizer',$3,$4)`,
        [`request-${String(ticket)}`, ticket, cycle, generation],
      );
    assert.equal((await projected(1, wide)).rowCount, 1);
    await assert.rejects(
      projected(2, null),
      /null value in column "revision"/u,
    );
    assert.equal((await requested(1, wide, wide)).rowCount, 1);
    await assert.rejects(
      requested(2, null, 1),
      /null value in column "work_cycle"/u,
    );
    await assert.rejects(
      requested(3, 1, null),
      /null value in column "finalization_generation"/u,
    );
  });
});
