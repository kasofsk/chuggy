/**
 * The credential that starts and reads workflow runs in the job's own
 * repository, minted for each ask.
 *
 * THE REPOSITORY IS THE JOB'S OWN. It is the one repository the attempt's
 * input bundle pinned, carried on the requester from what its bearer finds, so
 * nothing a pod sends chooses it; a bundle pinning none or several is refused.
 *
 * THE BINDING ENABLES IT. The project must bind that repository live with its
 * workflow runs setting on, read through the door that answers a retirement;
 * otherwise nothing is minted.
 *
 * EVERY ASK IS A FRESH MINT. A job must not be handed a token near its expiry,
 * so the mint is never answered from a held token and is not held after it. A
 * refusal is answered as one, never with a narrower token in its place.
 */

import { assertNever } from "../domain/assertNever.ts";
import type {
  CredentialIssued,
  CredentialIssuer,
} from "./credentialIssuers.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { ForgeRepositoryTokens } from "./forgeInstallation.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryLandingStore } from "./repositoryBinding.ts";

/** The one name this issuer serves. */
export const workflowRunsCredential = "chuggy.github-workflow-runs";

/** The variable a job's environment names the token's file by. */
export const workflowRunsCredentialVariable = "GH_TOKEN_FILE";

/** The name the token's file is written under in the bundle it is served as. */
export const workflowRunsCredentialFile = "token";

/** What the issuer mints with and reads the binding through, both under the requester's own tenant. */
export interface WorkflowRunsCredentialOptions {
  readonly tokens: ForgeRepositoryTokens;
  readonly bindings: Pick<ProjectRepositoryLandingStore, "landing">;
}

/** Whether the project binds `repository` live with its workflow runs on, a read that raised being an outage. */
async function workflowRunsCredentialEnabled(
  bindings: Pick<ProjectRepositoryLandingStore, "landing">,
  partition: Partition,
  repository: RepositoryId,
): Promise<"Enabled" | "NotEnabled" | "Unavailable"> {
  return bindings.landing(partition, repository).then(
    (bound) =>
      bound !== undefined &&
      bound.retiredAt === undefined &&
      bound.pipelinesRunnable
        ? "Enabled"
        : "NotEnabled",
    () => "Unavailable" as const,
  );
}

/** A fresh `runPipelines` mint for `repository`, answered as a bundle, a refusal or an outage. */
async function workflowRunsCredentialMinted(
  tokens: ForgeRepositoryTokens,
  partition: Partition,
  repository: RepositoryId,
): Promise<CredentialIssued> {
  const minted = await tokens
    .token(repository, partition, "runPipelines", { unheld: true })
    .catch(() => ({ minted: "Unavailable" }) as const);
  switch (minted.minted) {
    case "Token":
      return {
        issued: "Bundle",
        bundle: {
          credential: workflowRunsCredential,
          files: [
            {
              file: workflowRunsCredentialFile,
              content: { kind: "Secret", secret: minted.token },
            },
          ],
          variables: [
            {
              kind: "Path",
              variable: workflowRunsCredentialVariable,
              file: workflowRunsCredentialFile,
            },
          ],
          expiresAtMs: minted.expiresAtMs,
        },
      };
    case "Denied":
      return { issued: "Absent", reason: "IssuerRefused" };
    case "Unavailable":
      return { issued: "Unavailable" };
    default:
      return assertNever(minted);
  }
}

/** Issues `workflowRunsCredential` for the requester's own repository where its binding enables it, and serves no other name. */
export function workflowRunsCredentialIssuer(
  options: WorkflowRunsCredentialOptions,
): CredentialIssuer {
  return {
    issue: async (requester, credential) => {
      if (credential !== workflowRunsCredential) return { issued: "NotServed" };
      const repository = requester.repository;
      if (repository === undefined)
        return { issued: "Absent", reason: "IssuerRefused" };
      const enabled = await workflowRunsCredentialEnabled(
        options.bindings,
        requester.partition,
        repository,
      );
      if (enabled === "Unavailable") return { issued: "Unavailable" };
      if (enabled === "NotEnabled")
        return { issued: "Absent", reason: "NotEnabled" };
      return workflowRunsCredentialMinted(
        options.tokens,
        requester.partition,
        repository,
      );
    },
  };
}
