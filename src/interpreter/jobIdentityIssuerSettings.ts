/**
 * The identity issuer a deployment names: its base URL and the files of its
 * signing keys, named together or not at all.
 *
 * THE BASE URL IS READ EXACTLY. Tenants copy it into trust policies, so a URL
 * that would read back as other text, or whose path a router could take for a
 * parameter, is refused rather than normalised.
 */

import { z } from "zod";

import {
  isJobIdentitySafeName,
  jobIdentityIssuer,
  type JobIdentitySigner,
} from "./jobIdentityToken.ts";

/** The most key files one issuer is named with. */
export const jobIdentityKeyFilesMax = 16;

/** The longest path a key file is named by. */
export const jobIdentityKeyFileCharsMax = 4_096;

/** The variables one process names its identity issuer by. */
export interface JobIdentityIssuerVariables {
  readonly issuerBaseUrl: string;
  readonly keyFiles: string;
}

export type JobIdentityIssuerSettingsRead =
  | { readonly read: "Absent" }
  | {
      readonly read: "Settings";
      readonly issuerBaseUrl: string;
      readonly keyFiles: readonly string[];
    }
  | { readonly read: "Refused"; readonly why: string };

/** What a process holding an identity issuer signs and publishes with. */
export interface JobIdentityIssuing {
  readonly issuerBaseUrl: string;
  readonly signer: JobIdentitySigner;
}

const jobIdentityKeyFilesSchema = z
  .array(z.string().min(1).max(jobIdentityKeyFileCharsMax))
  .min(1)
  .max(jobIdentityKeyFilesMax);

/** The path every tenant's issuer is under, empty where the base URL has none. */
export function jobIdentityIssuerBasePath(issuerBaseUrl: string): string {
  const { pathname } = new URL(issuerBaseUrl);
  return pathname === "/" ? "" : pathname;
}

/** Why `text` is no issuer base URL, or nothing where it is one. */
function jobIdentityIssuerBaseUrlRefusal(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "https:") return "is not https";
  if (url.username !== "" || url.password !== "") return "carries credentials";
  if (url.port !== "") return "carries a port";
  if (text.includes("?")) return "carries a query";
  if (text.includes("#")) return "carries a fragment";
  if (text.endsWith("/")) return "ends in a slash";
  const path = jobIdentityIssuerBasePath(text);
  if (
    path
      .split("/")
      .slice(1)
      .some((segment) => !isJobIdentitySafeName(segment))
  )
    return "has a path segment that is not letters, digits, '.', '_' and '-'";
  if (`${url.origin}${path}` !== text) return "is not written as it reads back";
  if (jobIdentityIssuer(text, "t").result === "Refused")
    return "leaves no room for a tenant in an issuer";
  return undefined;
}

/** The key files `encoded` lists, or why it lists none. */
function jobIdentityKeyFilesRead(
  encoded: string,
): readonly string[] | { readonly why: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return { why: "is not JSON" };
  }
  const parsed = jobIdentityKeyFilesSchema.safeParse(decoded);
  return parsed.success
    ? parsed.data
    : { why: "is not a non-empty JSON list of file paths" };
}

/** The issuer a deployment names, without reading its files. */
export function jobIdentityIssuerSettings(
  named: JobIdentityIssuerVariables,
  environment: Readonly<Record<string, string | undefined>>,
): JobIdentityIssuerSettingsRead {
  const issuerBaseUrl = environment[named.issuerBaseUrl] ?? "";
  const keyFiles = environment[named.keyFiles] ?? "";
  if (issuerBaseUrl === "" && keyFiles === "") return { read: "Absent" };
  if (issuerBaseUrl === "" || keyFiles === "")
    return {
      read: "Refused",
      why: `${named.issuerBaseUrl} and ${named.keyFiles} are named together or not at all`,
    };
  const refusal = jobIdentityIssuerBaseUrlRefusal(issuerBaseUrl);
  if (refusal !== undefined)
    return { read: "Refused", why: `${named.issuerBaseUrl} ${refusal}` };
  const files = jobIdentityKeyFilesRead(keyFiles);
  if ("why" in files)
    return { read: "Refused", why: `${named.keyFiles} ${files.why}` };
  return { read: "Settings", issuerBaseUrl, keyFiles: files };
}
