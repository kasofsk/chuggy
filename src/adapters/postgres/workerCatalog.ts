/**
 * The worker catalog: what a scheduler publishes of its own admitted-images
 * list at boot, and what a read decorates an image with afterwards.
 *
 * A PUBLICATION IS ONE STATEMENT AND IT DELETES NOTHING. Every named entry is
 * written by image in a single insert, so a boot either publishes the whole
 * list or none of it, and an image this release no longer admits keeps the row
 * it was last published under, `published_at` and all.
 *
 * THE LIST BOUND IS REFUSED AT COMPOSITION rather than inside the check, which
 * a started runtime turns into a bare could-not-run with the reason dropped.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  admittedImagesMax,
  type AdmittedWorker,
  type Worker,
} from "../../interpreter/workerCatalog.ts";

interface AdmittedWorkerRow {
  readonly image: string;
  readonly name: string;
  readonly version: string;
}

/** The label each named image is catalogued under, absent where none is. */
export async function postgresWorkerCatalog(
  pool: pg.Pool,
  images: readonly string[],
): Promise<ReadonlyMap<string, Worker>> {
  if (images.length === 0) return new Map();
  const found = await pool.query<AdmittedWorkerRow>(
    sql`SELECT image,name,version FROM admitted_worker
         WHERE image=ANY(${[...images]}::text[])`,
  );
  return new Map(
    found.rows.map((row) => [
      row.image,
      { name: row.name, version: row.version },
    ]),
  );
}

/** Publishes this deployment's named images before its loop reads anything. */
export function postgresWorkerCatalogPrecondition(
  pool: pg.Pool,
  workers: readonly AdmittedWorker[],
): RuntimePrecondition {
  if (workers.length > admittedImagesMax)
    throw new RangeError(
      `a worker catalog publishes at most ${String(admittedImagesMax)} named images`,
    );
  const images = workers.map((worker) => worker.image);
  const names = workers.map((worker) => worker.name);
  const versions = workers.map((worker) => worker.version);
  return {
    name: "worker-catalog-published",
    check: async (signal) => {
      signal.throwIfAborted();
      if (workers.length === 0) return true;
      await pool.query(
        sql`INSERT INTO admitted_worker (image,name,version)
            SELECT * FROM unnest(${images}::text[],${names}::text[],${versions}::text[])
            ON CONFLICT (image) DO UPDATE
              SET name=EXCLUDED.name,version=EXCLUDED.version,published_at=now()`,
      );
      signal.throwIfAborted();
      return true;
    },
  };
}
