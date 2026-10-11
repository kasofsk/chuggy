/**
 * The runtime configuration a deployment mounts at `/config.json`.
 *
 * One artifact serves every installation, so the issuer, the client identity,
 * the audience and the redirect are read at start-up rather than built in. The
 * audience is the API's identity and not this console's host: without it the
 * access token comes back with an empty audience and every read is refused.
 *
 * `inviteCookieDomain` is the one key a deployment may leave out. It is the
 * domain the invite cookie is written for, which a deployment whose sign-in
 * service answers on another host of that domain names so the service is sent
 * the cookie; without it the cookie is this console's host's own.
 */

import { z } from "zod";

export const consoleConfigurationPath = "/config.json";
export const consoleScopesMax = 32;

/** The longest name the domain name system admits. */
export const consoleCookieDomainCharsMax = 253;

/** A host name and nothing a cookie reads as the start of another attribute. */
const consoleCookieDomainPattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu;

/** Lenient, so a deployment may carry fields a later console will read. The
 * issuer is an absolute address, so its host can name it when it fails. */
export const consoleConfigurationSchema = z.object({
  issuer: z.url({ protocol: /^https?$/u }),
  clientId: z.string().min(1),
  audience: z.string().min(1),
  redirectUri: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).max(consoleScopesMax),
  inviteCookieDomain: z
    .string()
    .regex(consoleCookieDomainPattern)
    .max(consoleCookieDomainCharsMax)
    .optional(),
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
