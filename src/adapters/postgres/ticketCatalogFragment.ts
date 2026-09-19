import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import type { TicketCatalogFragments } from "../../interpreter/ticketCatalog.ts";
import {
  ticketCatalogDocumentBytesMax,
  ticketCatalogReferenceRefusal,
} from "../../interpreter/ticketCatalog.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

/** The reference rule is the merged view's, not this store's, so it is asked rather than restated. */
function fragmentReference(reference: string): string {
  const refusal = ticketCatalogReferenceRefusal(reference);
  if (refusal !== undefined) throw new TypeError(refusal);
  return reference;
}

function fragmentContent(content: string): string {
  if (Buffer.byteLength(content) > ticketCatalogDocumentBytesMax)
    throw new RangeError("catalog fragment exceeds size limit");
  return content;
}

/** The catalog fragments a project holds durably, read and written by reference. */
export function postgresTicketCatalogFragments(
  pool: pg.Pool,
): TicketCatalogFragments {
  return {
    paths: async (partition: Partition) => {
      const found = await pool.query<{ path: string }>(sql`
        SELECT path FROM ticket_machine_catalog_fragment
        WHERE tenant=${partition.tenant} AND project=${partition.project}
        ORDER BY path`);
      return found.rows.map((row) => row.path);
    },
    read: async (partition, reference) => {
      const found = await pool.query<{ content: string }>(sql`
        SELECT content FROM ticket_machine_catalog_fragment
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND path=${fragmentReference(reference)}`);
      return found.rows[0]?.content;
    },
    write: async (partition, reference, content) => {
      await pool.query(sql`
        INSERT INTO ticket_machine_catalog_fragment(tenant,project,path,content)
        VALUES(${partition.tenant},${partition.project},${fragmentReference(reference)},${fragmentContent(content)})
        ON CONFLICT(tenant,project,path)
        DO UPDATE SET content=EXCLUDED.content,written_at=now()`);
    },
    remove: async (partition, reference) => {
      const removed = await pool.query(sql`
        DELETE FROM ticket_machine_catalog_fragment
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND path=${fragmentReference(reference)}`);
      return removed.rowCount === 1;
    },
  };
}
