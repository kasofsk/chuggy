/**
 * What answered a repository read that failed: the credential where it
 * resolved to none, git where it ran and did not succeed, and both where both.
 *
 * EVERY TERM IS A WORD FROM A CLOSED LIST OR AN INTEGER, so a label is never a
 * payload. No body, message, stream, path or address a forge or git wrote is
 * one of them, and an integer is printed only inside the range it can honestly
 * take.
 *
 * IT IS THE INTERPRETER'S because the forge adapter and the git adapter both
 * speak it and neither may reach the other. It imports nothing, so every
 * module holding an answer that carries it may import it.
 */

/** Why a minted credential was not one: the address, the claim, the forge's status, or what stopped the mint before it had one. */
export type CredentialMintCause =
  | "Address"
  | "NoInstallation"
  | "Status"
  | "Throttle"
  | "Key"
  | "Request"
  | "Body"
  | "Expiry"
  | "StoreRaised"
  | "MintRaised";

/** Every mint cause, so a suite iterates rather than restates. */
export const allCredentialMintCauses: readonly CredentialMintCause[] = [
  "Address",
  "NoInstallation",
  "Status",
  "Throttle",
  "Key",
  "Request",
  "Body",
  "Expiry",
  "StoreRaised",
  "MintRaised",
];

/** A mint's own account of why it answered no token, and the forge's status where the forge answered one. */
export interface CredentialMintEvidence {
  readonly mint: CredentialMintCause;
  readonly status?: number;
}

/** What a credential resolved to where it resolved to none. */
export type RepositoryCredentialRefusal = "Denied" | "Unavailable";

/** Every credential refusal, so a suite iterates rather than restates. */
export const allRepositoryCredentialRefusals: readonly RepositoryCredentialRefusal[] =
  ["Denied", "Unavailable"];

/** A credential that resolved to none, and the mint's cause where a mint gave one. */
export interface RepositoryCredentialEvidence {
  readonly credential: RepositoryCredentialRefusal;
  readonly mint?: CredentialMintCause;
  readonly status?: number;
}

/** The git command a failed read ran. */
export type RepositoryGitCommand = "ls-remote";

/** Every git command, so a suite iterates rather than restates. */
export const allRepositoryGitCommands: readonly RepositoryGitCommand[] = [
  "ls-remote",
];

/** What stopped a git call before it exited. */
export type RepositoryGitStop = "Timeout" | "OutputCeiling" | "Killed";

/** Every git stop, so a suite iterates rather than restates. */
export const allRepositoryGitStops: readonly RepositoryGitStop[] = [
  "Timeout",
  "OutputCeiling",
  "Killed",
];

/** A git command that ran and did not succeed: the code it exited with, or what stopped it. */
export type RepositoryGitEvidence =
  | { readonly git: RepositoryGitCommand; readonly exited?: number }
  | { readonly git: RepositoryGitCommand; readonly stopped: RepositoryGitStop };

/** What answered one failed repository read. */
export type RepositoryReadEvidence =
  | RepositoryCredentialEvidence
  | RepositoryGitEvidence
  | (RepositoryCredentialEvidence & RepositoryGitEvidence);

/** The statuses an HTTP answer can carry. */
export const repositoryEvidenceStatusMin = 100;
export const repositoryEvidenceStatusMax = 599;

/** The codes a process that exited and failed can carry. */
export const repositoryEvidenceExitCodeMin = 1;
export const repositoryEvidenceExitCodeMax = 255;

/** The range each integer term is held to, by the key it is printed under. */
const repositoryEvidenceIntegerRanges: Readonly<
  Record<string, readonly [number, number]>
> = {
  status: [repositoryEvidenceStatusMin, repositoryEvidenceStatusMax],
  exited: [repositoryEvidenceExitCodeMin, repositoryEvidenceExitCodeMax],
};

/** Whether one term may be printed as given: every word may, and an integer only inside its range. */
function repositoryReadEvidenceTermHeld(key: string, value: unknown): boolean {
  if (typeof value !== "number") return true;
  const range = repositoryEvidenceIntegerRanges[key];
  return (
    range !== undefined &&
    Number.isSafeInteger(value) &&
    value >= range[0] &&
    value <= range[1]
  );
}

/** The evidence as it may be printed, an integer outside its range left out rather than printed as given. */
export function repositoryReadEvidenceHeld(
  evidence: RepositoryReadEvidence,
): RepositoryReadEvidence {
  return Object.fromEntries(
    Object.entries(evidence).filter(([key, value]) =>
      repositoryReadEvidenceTermHeld(key, value),
    ),
  ) as RepositoryReadEvidence;
}
