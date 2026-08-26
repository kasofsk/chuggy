/**
 * The runtime configuration a deployment mounts at `/config.json`.
 *
 * One artifact serves every installation, so the issuer, the client identity,
 * the audience and the redirect are read at start-up rather than built in. The
 * audience is the API's identity and not this console's host: without it the
 * access token comes back with an empty audience and every read is refused.
 */

import { z } from "zod";

export const consoleConfigurationPath = "/config.json";
export const consoleScopesMax = 32;

/** Lenient, so a deployment may carry fields a later console will read. */
export const consoleConfigurationSchema = z.object({
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  audience: z.string().min(1),
  redirectUri: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).max(consoleScopesMax),
});

export type ConsoleConfiguration = Readonly<
  z.infer<typeof consoleConfigurationSchema>
>;

/** A trailing slash on the issuer would make every discovery URL a double one. */
export function parseConsoleConfiguration(
  value: unknown,
): ConsoleConfiguration {
  const parsed = consoleConfigurationSchema.parse(value);
  return { ...parsed, issuer: parsed.issuer.replace(/\/+$/u, "") };
}
