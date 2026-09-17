import { createHash } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { ContentRef } from "../../domain/chuggernaut/task.js";
import type { TicketContentStore } from "../../interpreter/ticketCatalog.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";

function contentReference(value: string | undefined): ContentRef {
  const reference = Number(value);
  if (!Number.isSafeInteger(reference) || reference < 1)
    throw new Error("content reference is outside its supported range");
  return ContentRef(reference);
}

async function contentPut(
  client: pg.PoolClient,
  partition: Partition,
  mediaType: string,
  content: string,
): Promise<ContentRef> {
  const digest = createHash("sha256").update(content).digest("hex");
  const inserted = await client.query<{ reference: string | null }>(sql`
    INSERT INTO ticket_machine_content(tenant,project,media_type,digest,content)
    VALUES(${partition.tenant},${partition.project},${mediaType},${digest},${content})
    ON CONFLICT(tenant,project,media_type,digest) DO NOTHING RETURNING reference::text`);
  const reference = inserted.rows[0]?.reference;
  if (reference !== undefined && reference !== null)
    return contentReference(reference);
  const existing = await client.query<{
    reference: string;
    content: string;
  }>(sql`
    SELECT reference::text,content FROM ticket_machine_content
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND media_type=${mediaType} AND digest=${digest}`);
  const row = existing.rows[0];
  if (row?.content !== content)
    throw new Error("ticket content digest collision");
  return contentReference(row.reference);
}

export function postgresTicketContent(
  pool: pg.Pool,
  partition: Partition,
): TicketContentStore {
  return {
    put: (mediaType, content) => {
      if (
        mediaType.length < 1 ||
        mediaType.length > 256 ||
        Buffer.byteLength(content) > 1_048_576
      )
        throw new RangeError("ticket content exceeds storage bounds");
      return postgresTransaction(pool, (client) =>
        contentPut(client, partition, mediaType, content),
      );
    },
    read: async (reference) => {
      const found = await pool.query<{
        media_type: string;
        content: string;
      }>(sql`
        SELECT media_type,content FROM ticket_machine_content WHERE tenant=${partition.tenant} AND project=${partition.project} AND reference=${reference}`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : { mediaType: row.media_type, content: row.content };
    },
  };
}
