/**
 * What a plane's routes answer with, and the refusal both planes add to every
 * route. The helper is no entry's export: each plane publishes its answers
 * with the refusal already in them.
 */

import { z } from "zod";

import {
  contractVersionRefusalSchema,
  contractVersionRefusalStatus,
} from "./workerContract.ts";

/** What one status answers with: a body its schema reads, or no body at all. */
export type WorkerPlaneAnswer = z.ZodType | "empty";

/** Every status each route of one plane answers with, and what it answers. */
export type WorkerPlaneAnswers<Name extends string> = Readonly<
  Record<Name, Readonly<Record<number, WorkerPlaneAnswer>>>
>;

/**
 * A plane's answers with the refusal every route gives a release the plane
 * does not serve, beside whatever the route's own status answers. The refusal
 * is read first, because a route's own stop would drop the range it names.
 */
export function workerPlaneAnswersRefusingVersions<Name extends string>(
  answers: WorkerPlaneAnswers<Name>,
): WorkerPlaneAnswers<Name> {
  return Object.fromEntries(
    Object.entries<Readonly<Record<number, WorkerPlaneAnswer>>>(answers).map(
      ([route, statuses]): [
        string,
        Readonly<Record<number, WorkerPlaneAnswer>>,
      ] => {
        const own = statuses[contractVersionRefusalStatus];
        if (own === "empty")
          throw new Error(`${route} answers the refusal's status with no body`);
        return [
          route,
          {
            ...statuses,
            [contractVersionRefusalStatus]:
              own === undefined
                ? contractVersionRefusalSchema
                : z.union([contractVersionRefusalSchema, own]),
          },
        ];
      },
    ),
  ) as WorkerPlaneAnswers<Name>;
}
