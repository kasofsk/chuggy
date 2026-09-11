/**
 * Making a repository on GitHub: the collection each mode is made in, the first
 * commit that puts a branch under it, and the ruleset that reserves that branch.
 *
 * ALL THREE RUN UNDER ONE INSTALLATION-WIDE TOKEN, because the first of them is
 * asked before the repository it makes exists and a token cannot be scoped to a
 * repository a forge does not have. The mint is cached by what it is good for,
 * so the two acts after it reuse the token the first one took rather than
 * asking twice, and an installation that grants only selected repositories
 * refuses all three the same way rather than some of them.
 *
 * THE APP'S IDENTITY IS WHAT THE RULESET LETS PAST. A bypass is granted to an
 * integration and not to a token, so the ruleset names this deployment's own app
 * and the repository's administrators and nothing else — which is what keeps a
 * token minted for an agent's own work off the branch it reserves.
 *
 * A NAME ALREADY TAKEN IS READ OUT OF THE REFUSAL AND NOT OUT OF THE STATUS,
 * because a forge answers it with the same status it answers every other
 * unacceptable body with. A refusal this side cannot recognise stays a refusal
 * carrying the forge's own words, so the caller is told what was wrong either
 * way.
 */

import { z } from "zod";

import {
  asGitRefName,
  asRepositoryId,
  type GitRefName,
} from "../../interpreter/finalizer.ts";
import type {
  ForgeInstallation,
  ForgeInstallationTokens,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeRepositoryCreated,
  ForgeRepositoryCreation,
  ForgeRepositoryCreationRequest,
  ForgeRepositoryRulesetCreated,
  ForgeRepositoryRulesetRequest,
  ForgeRepositorySeeded,
  ForgeRepositorySeedRequest,
} from "../../interpreter/forgeRepositoryCreation.ts";
import {
  githubAppRead,
  githubBearerSend,
  githubRequestBounds,
  type GithubAppAnswered,
  type GithubAppRequest,
  type GithubRequestBounds,
  type GithubRequestOptions,
} from "./githubAppRequest.ts";

/** The status each of the three acts is answered with. */
const githubCreatedStatus = 201;

/** The prefix a branch reference lives under, which is the one kind of reference these acts name. */
const githubBranchRefPrefix = "refs/heads/";

/** How a forge says the name is taken, which is the one refusal with its own answer. */
const githubNameTakenPattern = /already exists/iu;

/** What the ruleset is called on the repository it reserves. */
const githubRulesetName = "chuggy portal + admins own main";

/** The repository role a ruleset bypass names an administrator by. */
const githubAdministratorRoleId = 5;

/** The fields of a made repository this tree reads, the rest being the forge's own account of it. */
const githubMadeRepositorySchema = z.object({
  clone_url: z.string().min(1),
  default_branch: z.string().min(1),
});

/** Everything the adapter is composed with: where the forge is, what mints for it, and which app it is. */
export interface GithubRepositoryCreationOptions extends GithubRequestOptions {
  readonly tokens: ForgeInstallationTokens;
  readonly appId: string;
}

interface GithubRepositoryCreationState {
  readonly bounds: GithubRequestBounds;
  readonly tokens: ForgeInstallationTokens;
  readonly appId: number;
}

/** The short name a forge spells a branch reference by, or nothing where the reference is not a branch. */
function githubBranchOf(ref: GitRefName): string | undefined {
  return ref.startsWith(githubBranchRefPrefix) &&
    ref.length > githubBranchRefPrefix.length
    ? ref.slice(githubBranchRefPrefix.length)
    : undefined;
}

/** One path as a forge addresses it, each segment escaped and the separators kept. */
function githubPathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** What a mint this app was refused says, which is the one refusal with no forge message behind it. */
const githubMintRefusedMessage =
  "the app is not installed on the account with what this act needs";

/** One request under the installation's own token, a refused mint being a refusal like any other. */
async function githubCreationSend(
  own: GithubRepositoryCreationState,
  installation: ForgeInstallation,
  request: GithubAppRequest,
): Promise<GithubAppAnswered> {
  const minted = await own.tokens.mint({
    installation,
    permissions: "administer",
  });
  if (minted.minted === "Unavailable") return { answered: "Unavailable" };
  if (minted.minted === "Denied")
    return { answered: "Denied", message: githubMintRefusedMessage };
  return githubBearerSend(own.bounds, request, minted.token);
}

/** Where one mode's repository is made, and what the forge is told to make. */
function githubCreationRequest(
  own: GithubRepositoryCreationState,
  request: ForgeRepositoryCreationRequest,
): GithubAppRequest {
  const isPrivate = request.visibility === "private";
  if (request.creation.mode === "Organization")
    return {
      url: new URL(
        `/orgs/${encodeURIComponent(request.installation.account)}/repos`,
        own.bounds.apiUrl,
      ),
      method: "POST",
      okStatus: githubCreatedStatus,
      body: { name: request.name, private: isPrivate, auto_init: false },
    };
  const template = request.creation.template;
  return {
    url: new URL(
      `/repos/${encodeURIComponent(template.account)}/${encodeURIComponent(template.name)}/generate`,
      own.bounds.apiUrl,
    ),
    method: "POST",
    okStatus: githubCreatedStatus,
    body: {
      owner: request.installation.account,
      name: request.name,
      private: isPrivate,
    },
  };
}

/** One made repository as a binding names it, or nothing where the answer cannot be read as one. */
function githubMadeRepository(row: {
  readonly clone_url: string;
  readonly default_branch: string;
}): ForgeRepositoryCreated {
  try {
    return {
      created: "Repository",
      repository: {
        url: asRepositoryId(row.clone_url),
        defaultBranch: asGitRefName(
          `${githubBranchRefPrefix}${row.default_branch}`,
        ),
      },
    };
  } catch {
    return { created: "Unavailable" };
  }
}

async function githubRepositoryCreate(
  own: GithubRepositoryCreationState,
  request: ForgeRepositoryCreationRequest,
): Promise<ForgeRepositoryCreated> {
  const answered = await githubCreationSend(
    own,
    request.installation,
    githubCreationRequest(own, request),
  );
  if (answered.answered === "Unavailable") return { created: "Unavailable" };
  if (answered.answered === "Denied")
    return githubNameTakenPattern.test(answered.message)
      ? { created: "Exists" }
      : { created: "Refused", message: answered.message };
  const read = await githubAppRead(
    own.bounds,
    answered.response,
    githubMadeRepositorySchema,
  );
  return read === undefined
    ? { created: "Unavailable" }
    : githubMadeRepository(read);
}

async function githubRepositorySeed(
  own: GithubRepositoryCreationState,
  request: ForgeRepositorySeedRequest,
): Promise<ForgeRepositorySeeded> {
  const branch = githubBranchOf(request.branch);
  if (branch === undefined)
    return {
      seeded: "Refused",
      message: "the default branch is not a branch reference",
    };
  const answered = await githubCreationSend(own, request.installation, {
    url: new URL(
      `/repos/${encodeURIComponent(request.installation.account)}/${encodeURIComponent(request.name)}/contents/${githubPathSegments(request.path)}`,
      own.bounds.apiUrl,
    ),
    method: "PUT",
    okStatus: githubCreatedStatus,
    body: {
      message: request.message,
      content: Buffer.from(request.content, "utf8").toString("base64"),
      branch,
    },
  });
  if (answered.answered === "Unavailable") return { seeded: "Unavailable" };
  if (answered.answered === "Denied")
    return { seeded: "Refused", message: answered.message };
  await answered.response.body?.cancel().catch(() => undefined);
  return { seeded: "Seeded" };
}

/** The ruleset that reserves a default branch to this app and the repository's administrators. */
function githubRulesetBody(own: GithubRepositoryCreationState): unknown {
  return {
    name: githubRulesetName,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "update" },
    ],
    bypass_actors: [
      {
        actor_id: own.appId,
        actor_type: "Integration",
        bypass_mode: "always",
      },
      {
        actor_id: githubAdministratorRoleId,
        actor_type: "RepositoryRole",
        bypass_mode: "always",
      },
    ],
  };
}

async function githubRepositoryRuleset(
  own: GithubRepositoryCreationState,
  request: ForgeRepositoryRulesetRequest,
): Promise<ForgeRepositoryRulesetCreated> {
  const answered = await githubCreationSend(own, request.installation, {
    url: new URL(
      `/repos/${encodeURIComponent(request.installation.account)}/${encodeURIComponent(request.name)}/rulesets`,
      own.bounds.apiUrl,
    ),
    method: "POST",
    okStatus: githubCreatedStatus,
    body: githubRulesetBody(own),
  });
  if (answered.answered === "Unavailable") return { created: "Unavailable" };
  if (answered.answered === "Denied")
    return { created: "Refused", message: answered.message };
  await answered.response.body?.cancel().catch(() => undefined);
  return { created: "Ruleset" };
}

/** The three acts over their options, refusing at construction what they could never serve. */
export function githubRepositoryCreation(
  options: GithubRepositoryCreationOptions,
): ForgeRepositoryCreation {
  const appId = Number(options.appId);
  if (!Number.isSafeInteger(appId) || appId <= 0)
    throw new RangeError("github repositories: the app id is not an identity");
  const own: GithubRepositoryCreationState = {
    bounds: githubRequestBounds(options),
    tokens: options.tokens,
    appId,
  };
  return {
    create: (request) => githubRepositoryCreate(own, request),
    seed: (request) => githubRepositorySeed(own, request),
    reserveDefaultBranch: (request) => githubRepositoryRuleset(own, request),
  };
}
