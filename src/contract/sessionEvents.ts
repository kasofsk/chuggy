import { z } from "zod";

import {
  countSchema,
  sessionIdentityCharsMax,
  sessionKindCharsMax,
  sessionStoreBatchesMax,
  sessionStoreStreamCharsMax,
} from "./http.ts";
import { sessionStates } from "./rosters.ts";

const sessionIdentitySchema = z.string().min(1).max(sessionIdentityCharsMax);

export const sessionChangeResourceSchema = z.union([
  z.strictObject({
    session: sessionIdentitySchema,
    kind: z.string().min(1).max(sessionKindCharsMax),
    turn: sessionIdentitySchema,
  }),
  z.strictObject({
    session: sessionIdentitySchema,
    kind: z.string().min(1).max(sessionKindCharsMax),
    stream: z.string().min(1).max(sessionStoreStreamCharsMax),
    batch: countSchema.max(sessionStoreBatchesMax),
  }),
  z.strictObject({
    session: sessionIdentitySchema,
    kind: z.string().min(1).max(sessionKindCharsMax),
    state: z.enum(sessionStates),
  }),
]);

export type SessionChangeResource = z.infer<typeof sessionChangeResourceSchema>;
