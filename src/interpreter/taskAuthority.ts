/**
 * The authority one attempt runs under: what structured task policy granted it,
 * and every operation this tree can perform on a grant.
 *
 * WIDENING IS NOT A FUNCTION THIS MODULE HAS, and that is the whole point of
 * the shape rather than a convention about how to call it. A `TaskAuthority`
 * keeps its grant behind a symbol this module does not export, so no other
 * module can write the key and no object literal that does not already hold one
 * is that type. The ways to obtain one are minting it from what policy granted
 * and meeting it with a request, and the meet FILTERS THE HELD VALUES rather
 * than reading the request's — so its result is a subset of what was held
 * whatever the request asked for, including a request naming a tool the grant
 * never carried.
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
 *
 * A REACH NO ORDER NAMES IS NOT A POINT ON IT, and every operation here says so
 * rather than comparing positions and getting a position back. The mint refuses
 * one, because policy is the untyped boundary this module exists to survive; the
 * meet treats an asked-for one as no opinion at all, so it can only leave the
 * held reach where it was; and the order refuses it on either side, which is
 * what keeps the postcondition below able to fail. Comparing list positions
 * instead would make an unrecognised reach the lowest value there is and
 * therefore the winner of every meet — outside the vocabulary and above the
 * ceiling at once.
 *
 * WHAT IS HANDED BACK IS FROZEN AT BOTH LEVELS, ARRAYS INCLUDED. "Movable only
 * downward" is a claim about every later reader, and a reader that could append
 * to a live list, overwrite a field, or reach the key through
 * `Object.getOwnPropertySymbols` and put a whole other grant behind it would
 * widen the same authority for all of them — after the postcondition below had
 * already passed on it. So the grant is frozen when it is built and the object
 * holding it is frozen around it, and a caller that tries either fails where it
 * tried rather than silently succeeding.
 *
 * SUBSTITUTING A DIFFERENT AUTHORITY IS THE MINT'S CONCERN, NOT THIS ONE, and
 * the two are worth keeping apart. A holder that rebuilds an object around the
 * reflected key is not raising a composed authority; it is asserting a policy
 * answer, which `grantTaskAuthority` lets any caller do and which the paragraph
 * above says is the one boundary here. What the freeze buys is that the value
 * `resolveTaskAuthority` checked is the value `place` receives.
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

/** Where this reach sits on the order, or nothing when the order does not name it. */
function authorityReachAt(access: FilesystemAccess): number | undefined {
  const at = filesystemAccessOrder.indexOf(access);
  return at === -1 ? undefined : at;
}

/** The grant as an authority holds it: frozen to its lists, and the holder frozen around it. */
function authorityHeld(grant: PolicyAuthorityGrant): TaskAuthority {
  return Object.freeze({
    [authorityGrant]: Object.freeze({
      tools: Object.freeze(grant.tools),
      credentials: Object.freeze(grant.credentials),
      network: grant.network,
      filesystem: grant.filesystem,
      mayCompleteTask: grant.mayCompleteTask,
    }),
  });
}

/** Mints the authority policy granted, which is the widest one that will ever exist. */
export function grantTaskAuthority(grant: PolicyAuthorityGrant): TaskAuthority {
  if (authorityReachAt(grant.filesystem) === undefined) {
    throw new RangeError(
      "task authority: a policy grant names a filesystem reach this order does not",
    );
  }
  return authorityHeld({
    tools: authoritySorted(grant.tools),
    credentials: authoritySorted(grant.credentials),
    network: grant.network,
    filesystem: grant.filesystem,
    mayCompleteTask: grant.mayCompleteTask,
  });
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

/** The lower of the two reaches; a reach the order does not name asks for nothing. */
function authorityMeetFilesystem(
  held: FilesystemAccess,
  asked: FilesystemAccess | undefined,
): FilesystemAccess {
  if (asked === undefined) return held;
  const wanted = authorityReachAt(asked);
  const holds = authorityReachAt(held);
  if (wanted === undefined || holds === undefined) return held;
  return wanted < holds ? asked : held;
}

/** Meets one authority with one request, which can lower every field and raise none. */
export function narrowTaskAuthority(
  authority: TaskAuthority,
  request: AuthorityRequest,
): TaskAuthority {
  const held = authority[authorityGrant];
  return authorityHeld({
    tools: authorityMeetNames(held.tools, request.tools),
    credentials: authorityMeetNames(held.credentials, request.credentials),
    network: held.network && (request.network ?? true),
    filesystem: authorityMeetFilesystem(held.filesystem, request.filesystem),
    mayCompleteTask: held.mayCompleteTask && (request.mayCompleteTask ?? true),
  });
}

/** Whether one reach is at most the other, which no reach outside the order is. */
function authorityReachWithin(
  narrower: FilesystemAccess,
  wider: FilesystemAccess,
): boolean {
  const at = authorityReachAt(narrower);
  const ceiling = authorityReachAt(wider);
  return at !== undefined && ceiling !== undefined && at <= ceiling;
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
    authorityReachWithin(narrower.filesystem, wider.filesystem) &&
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
