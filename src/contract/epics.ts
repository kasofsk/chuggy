/**
 * The epic wire: the content an epic holds, the two writes that change it, and
 * the queries that list and replay it.
 *
 * The limits restate the ones the domain decides by, because this file may not
 * reach it; `test/contract/epics.test.ts` holds the two to each other. The
 * schemas bound the shape and the server's decision refuses the content.
 */

import { z } from "zod";

import { fieldsOnly } from "./fields.ts";
import { ticketSearchCharsMax } from "./http.ts";

export const epicTitleCharsMax = 200;
export const epicSummaryCharsMax = 600;
export const epicContentBytesMax = 65_536;
export const epicTicketsMax = 100;

export const epicVisibilitySchema = z.enum(["Active", "Archived"]);
export type EpicVisibility = z.infer<typeof epicVisibilitySchema>;

const epicPositiveSchema = z.number().int().min(1).safe();

/** A set of ticket numbers: ascending, each once. */
export const epicTicketsSchema = z
  .array(epicPositiveSchema)
  .transform((tickets) =>
    [...new Set(tickets)].sort((left, right) => left - right),
  );

/** A blank summary is none. */
const epicSummarySchema = z
  .string()
  .optional()
  .transform((summary) =>
    summary === undefined || summary.trim() === "" ? undefined : summary,
  );

const epicContentShape = z.strictObject({
  title: z.string(),
  summary: epicSummarySchema,
  description: z.string(),
  visibility: epicVisibilitySchema,
  tickets: epicTicketsSchema,
});

export interface EpicContent {
  readonly title: string;
  readonly summary?: string;
  readonly description: string;
  readonly visibility: EpicVisibility;
  readonly tickets: readonly number[];
}

export const epicContentSchema = epicContentShape.transform(
  ({ summary, ...rest }): EpicContent =>
    summary === undefined ? rest : { ...rest, summary },
);

export const epicCreateRequestSchema = z.strictObject({
  kind: z.literal("Create"),
  content: epicContentSchema,
});

export const epicReviseRequestSchema = z.strictObject({
  kind: z.literal("Revise"),
  epic: epicPositiveSchema,
  expected: epicPositiveSchema,
  content: epicContentSchema,
});

export const epicWriteRequestSchema = z.discriminatedUnion("kind", [
  epicCreateRequestSchema,
  epicReviseRequestSchema,
]);
export type EpicWriteRequest = z.infer<typeof epicWriteRequestSchema>;

export const epicPageLimitMax = 50;
export const epicPageLimitDefault = 20;

export const epicListVisibilities = ["Active", "Archived", "All"] as const;
export const epicListSorts = ["newest", "oldest", "title"] as const;

function epicQueryInteger(minimum: number, maximum?: number) {
  return z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/u)
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .safe()
        .min(minimum)
        .max(maximum ?? Number.MAX_SAFE_INTEGER),
    );
}

const epicPageShape = {
  after: epicQueryInteger(0).optional(),
  limit: epicQueryInteger(1, epicPageLimitMax).default(epicPageLimitDefault),
};

function epicQuery<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess(
    (value) => fieldsOnly(value, Object.keys(shape)),
    z.strictObject(shape),
  );
}

export const epicListQuerySchema = epicQuery({
  search: z.string().max(ticketSearchCharsMax).optional(),
  visibility: z.enum(epicListVisibilities).optional(),
  ticket: epicQueryInteger(1).optional(),
  sort: z.enum(epicListSorts).optional(),
  ...epicPageShape,
});
export type EpicListQuery = z.infer<typeof epicListQuerySchema>;

export const epicHistoryQuerySchema = epicQuery(epicPageShape);
export type EpicHistoryQuery = z.infer<typeof epicHistoryQuerySchema>;

/** Parses a request body, throwing a `ZodError` the route answers as a bad request. */
export function epicWriteRequestParse(body: unknown): EpicWriteRequest {
  return epicWriteRequestSchema.parse(body);
}

export function epicListQueryParse(query: unknown): EpicListQuery {
  return epicListQuerySchema.parse(query);
}

export function epicHistoryQueryParse(query: unknown): EpicHistoryQuery {
  return epicHistoryQuerySchema.parse(query);
}

/** What a write's body carries beside the content: the kind, an epic number and a revision. */
export const epicWriteEnvelopeBytesMax = 1_024;

/**
 * The most bytes a write's body may weigh: the content bound plus the
 * envelope, a per-route bound over the vendor media type's global one.
 */
export const epicWriteBodyBytesMax =
  epicContentBytesMax + epicWriteEnvelopeBytesMax;
