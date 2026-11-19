/**
 * A project's access tokens as `access_token` keeps them, by the digest of
 * each secret and never the secret.
 *
 * A MINT COUNTS AND INSERTS UNDER ONE LOCK. The project's mints are serialized
 * on an advisory lock taken in a statement of its own, so the counts read after
 * it see every mint committed while it waited, and neither
 * `accessTokensHeldMax` nor `accessTokensProjectMax` is passed by two mints
 * racing. Expired tokens count until they are deleted.
 *
 * A PRESENTED TOKEN IS READ BY ITS DIGEST ON EVERY REQUEST, never cached, and
 * answers only while it is unexpired on the database's clock and its recovery
 * epoch is the newest, so a deletion or a restore refuses the next request.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  accessTokenAccesses,
  accessTokensHeldMax,
  accessTokensProjectMax,
} from "../../contract/accessToken.ts";
import type {
  AccessTokenBearerAuthority,
  AccessTokenBearerSecret,
  AccessTokenMinting,
  AccessTokenRecord,
  AccessTokenStore,
  AccessTokenWritten,
} from "../../interpreter/accessToken.ts";
import { asPrincipal } from "../../interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";

interface AccessTokenRow {
  token: string;
  name: string;
  access: string;
  maker: string;
  created_at: Date;
  expires_at: Date;
}

function accessTokenRecord(row: AccessTokenRow): AccessTokenRecord {
  const access = accessTokenAccesses.find((known) => known === row.access);
  if (access === undefined)
    throw new Error(`access token ${row.token} holds an unknown access`);
  return {
    token: row.token,
    name: row.name,
    access,
    maker: asPrincipal(row.maker),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** One mint, refused where the project is not active, the maker holds the name, or either bound is reached. */
async function accessTokenMinted(
  client: pg.PoolClient,
  partition: Partition,
  minting: AccessTokenMinting,
): Promise<AccessTokenWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'access-token:' || ${partition.tenant} || '/' || ${partition.project}, 0))::text AS locked`,
  );
  const counted = await client.query<{
    active: boolean;
    taken: boolean;
    held: number;
    total: number;
  }>(
    sql`SELECT EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${partition.tenant} AND p.project=${partition.project}
            AND p.lifecycle='Active') AS active,
        EXISTS(SELECT 1 FROM access_token t
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
            AND t.maker=${minting.maker} AND t.name=${minting.name}) AS taken,
        (SELECT count(*)::int FROM access_token t
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
            AND t.maker=${minting.maker}) AS held,
        (SELECT count(*)::int FROM access_token t
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}) AS total`,
  );
  const row = counted.rows[0];
  if (row?.active !== true) return { written: "NotFound" };
  if (row.taken) return { written: "NameTaken" };
  if (row.held >= accessTokensHeldMax)
    return { written: "LimitReached", bound: "Held" };
  if (row.total >= accessTokensProjectMax)
    return { written: "LimitReached", bound: "Project" };
  const inserted = await client.query<AccessTokenRow>(
    sql`INSERT INTO access_token(tenant,project,token,name,access,maker,secret_digest,expires_at,recovery_epoch)
        VALUES(${partition.tenant},${partition.project},${minting.token},${minting.name},${minting.access},${minting.maker},${minting.secretDigest},
          now()+make_interval(days => ${minting.lifetimeDays}::int),
          (SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1))
        RETURNING token,name,access,maker,created_at,expires_at`,
  );
  const record = inserted.rows[0];
  if (record === undefined)
    throw new Error("an access token insert wrote no row");
  return { written: "Minted", record: accessTokenRecord(record) };
}

export function postgresAccessTokens(pool: pg.Pool): AccessTokenStore {
  return {
    mint: (partition, minting) =>
      postgresTransaction(pool, (client) =>
        accessTokenMinted(client, partition, minting),
      ),
    listed: async (partition, maker) => {
      const listed = await pool.query<AccessTokenRow>(
        sql`SELECT t.token,t.name,t.access,t.maker,t.created_at,t.expires_at
              FROM access_token t
             WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
               AND (${maker ?? null}::text IS NULL
                    OR t.maker=${maker ?? null})
             ORDER BY t.created_at DESC, t.token DESC
             LIMIT ${accessTokensProjectMax}`,
      );
      return listed.rows.map(accessTokenRecord);
    },
    deleted: async (partition, token, maker) => {
      const deleted = await pool.query(
        sql`DELETE FROM access_token t
             WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
               AND t.token=${token}
               AND (${maker ?? null}::text IS NULL
                    OR t.maker=${maker ?? null})`,
      );
      return (deleted.rowCount ?? 0) === 1;
    },
  };
}

interface AccessTokenBearerRow extends AccessTokenRow {
  tenant: string;
  project: string;
}

/**
 * The API's side of a presented token: its maker and project, or nothing.
 * `digest` is the one the mint keeps, which is all the row holds of a secret.
 */
export function postgresAccessTokenBearerAuthority(
  pool: pg.Pool,
  digest: (secret: AccessTokenBearerSecret) => string,
): AccessTokenBearerAuthority {
  return {
    authenticate: async (secret) => {
      const found = await pool.query<AccessTokenBearerRow>(
        sql`SELECT t.tenant,t.project,t.token,t.name,t.access,t.maker,t.created_at,t.expires_at
              FROM access_token t
             WHERE t.secret_digest=${digest(secret)}
               AND t.expires_at > now()
               AND t.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r
                                      ORDER BY r.ordinal DESC LIMIT 1)`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      const record = accessTokenRecord(row);
      return {
        partition: {
          tenant: asTenantId(row.tenant),
          project: asProjectId(row.project),
        },
        token: record.token,
        name: record.name,
        access: record.access,
        principal: record.maker,
        expiresAt: record.expiresAt,
      };
    },
  };
}
