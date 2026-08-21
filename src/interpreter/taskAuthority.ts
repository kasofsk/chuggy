/**
 * The authority one attempt runs under: what structured task policy granted it,
 * and every operation this tree can perform on a grant.
 *
 * WIDENING IS NOT A FUNCTION THIS MODULE HAS, and that is the whole point of
 * the shape rather than a convention about how to call it. A `TaskAuthority`
 * keeps its grant behind a symbol this module does not export, so no other
 * module can build one, spread a wider field into one, or name the key to
 * replace the grant inside it. The ways to obtain one are minting it from what
 * policy granted and meeting it with a request, and the meet FILTERS THE HELD
 * VALUES rather than reading the request's — so its result is a subset of what
 * was held whatever the request asked for, including a request naming a tool
 * the grant never carried.
 *
 * THE MINT IS THE ONE PLACE A POLICY ANSWER ENTERS, and it is what the claim
 * above is anchored to: everything after it descends. A caller handing the mint
 * a grant policy never gave would be fabricating a policy answer rather than
 * widening a composed authority, and the launch path calls it once, with what
 * `ExecutionPolicy` returned alongside the profile.
 *
 * SO ORDER DOES NOT MATTER, WHICH IS WHAT "A LATER BLOCK MUST NOT WIDEN WHAT AN
 * EARLIER ONE NARROWED" REDUCES TO. Set intersection, conjunction and a minimum
 * over a total order are each commutative, associative and idempotent, so the
 * fold over a list of requests is the meet of all of them: permuting the blocks
 * produces the same authority, and appending one can only lower it. That is a
 * stronger statement than the prohibition, and it is the one the suite proves.
 *
 * NOTHING HERE READS PROSE. A request is structured data — identifiers, a flag
 * and a point on a small total order — and `./taskBriefing.ts` renders prose
 * without ever handing it here. A prompt may therefore ask an agent to run a
 * test suite, and whether it may run one is decided by a value that never met
 * the sentence asking.
 *
 * AN OMITTED FIELD ASKS FOR NOTHING. It is the identity of the meet rather than
 * a default, so a block that has no opinion about the filesystem leaves the
 * filesystem exactly where the block before it left it.
 */

/** How far into a workspace a task may reach, written least first. */
export type FilesystemAccess = "None" | "ReadWorkspace" | "WriteWorkspace";

/** Every filesystem access, least first, which is also the order the meet below minimizes over. */
export const filesystemAccessOrder: readonly FilesystemAccess[] = [
  "None",
  "ReadWorkspace",
  "WriteWorkspace",
];

/** What structured task policy granted one attempt, which is the ceiling and never rises. */
export interface PolicyAuthorityGrant {
  readonly tools: readonly string[];
  readonly credentials: readonly string[];
  readonly network: boolean;
  readonly filesystem: FilesystemAccess;
  readonly mayCompleteTask: boolean;
}

/** What one composed block asks to narrow, every field of it optional and none of it prose. */
export interface AuthorityRequest {
  readonly tools?: readonly string[];
  readonly credentials?: readonly string[];
  readonly network?: boolean;
  readonly filesystem?: FilesystemAccess;
  readonly mayCompleteTask?: boolean;
}

/**
 * The key a resolved authority holds its grant under. It is not exported, so
 * every value of the type below was produced by this module.
 */
const authorityGrant: unique symbol = Symbol("chuggy:task-authority");

/** A resolved authority: mintable only from a policy grant, and movable only downward. */
export interface TaskAuthority {
  readonly [authorityGrant]: PolicyAuthorityGrant;
}

/** The sorted duplicate-free spelling of an identifier list, so two grants compare by value. */
function authoritySorted(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort();
}

/** The grant as a resolved authority holds it, which is the only reader there is. */
export function taskAuthorityGrant(
  authority: TaskAuthority,
): PolicyAuthorityGrant {
  return authority[authorityGrant];
}

/** Mints the authority policy granted, which is the widest one that will ever exist. */
export function grantTaskAuthority(grant: PolicyAuthorityGrant): TaskAuthority {
  return {
    [authorityGrant]: {
      tools: authoritySorted(grant.tools),
      credentials: authoritySorted(grant.credentials),
      network: grant.network,
      filesystem: grant.filesystem,
      mayCompleteTask: grant.mayCompleteTask,
    },
  };
}

/** The names held that were also asked for, which is a subset of the held ones by construction. */
function authorityMeetNames(
  held: readonly string[],
  asked: readonly string[] | undefined,
): readonly string[] {
  if (asked === undefined) return held;
  const wanted = new Set(asked);
  return held.filter((name) => wanted.has(name));
}

/** The lower of the two reaches, which is the held one when the request has no opinion. */
function authorityMeetFilesystem(
  held: FilesystemAccess,
  asked: FilesystemAccess | undefined,
): FilesystemAccess {
  if (asked === undefined) return held;
  return filesystemAccessOrder.indexOf(asked) <
    filesystemAccessOrder.indexOf(held)
    ? asked
    : held;
}

/** Meets one authority with one request, which can lower every field and raise none. */
export function narrowTaskAuthority(
  authority: TaskAuthority,
  request: AuthorityRequest,
): TaskAuthority {
  const held = authority[authorityGrant];
  return {
    [authorityGrant]: {
      tools: authorityMeetNames(held.tools, request.tools),
      credentials: authorityMeetNames(held.credentials, request.credentials),
      network: held.network && (request.network ?? true),
      filesystem: authorityMeetFilesystem(held.filesystem, request.filesystem),
      mayCompleteTask:
        held.mayCompleteTask && (request.mayCompleteTask ?? true),
    },
  };
}

/** Whether the first grant permits everything the second does, which is the order the meet descends. */
export function taskAuthorityIncludes(
  wider: PolicyAuthorityGrant,
  narrower: PolicyAuthorityGrant,
): boolean {
  const tools = new Set(wider.tools);
  const credentials = new Set(wider.credentials);
  return (
    narrower.tools.every((tool) => tools.has(tool)) &&
    narrower.credentials.every((credential) => credentials.has(credential)) &&
    (wider.network || !narrower.network) &&
    filesystemAccessOrder.indexOf(narrower.filesystem) <=
      filesystemAccessOrder.indexOf(wider.filesystem) &&
    (wider.mayCompleteTask || !narrower.mayCompleteTask)
  );
}

/**
 * Folds every block's request into the granted ceiling. The postcondition is
 * house rule 10's: a resolved authority the grant does not include is a broken
 * meet, and nothing downstream is in a position to notice.
 */
export function resolveTaskAuthority(
  grant: PolicyAuthorityGrant,
  requests: readonly AuthorityRequest[],
): TaskAuthority {
  const resolved = requests.reduce(
    (held, request) => narrowTaskAuthority(held, request),
    grantTaskAuthority(grant),
  );
  if (!taskAuthorityIncludes(grant, taskAuthorityGrant(resolved))) {
    throw new RangeError(
      "task authority: a narrowing produced an authority the policy grant does not include",
    );
  }
  return resolved;
}
