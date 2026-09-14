import type { Authority } from "./operationInbox.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

export type AuthorizedResult<Value> =
  | { readonly result: "NotFound" }
  | { readonly result: "Authorized"; readonly value: Value };

/** Authorizes each invocation before evaluating its resource read. */
export function authorizedProjectRead<Arguments extends unknown[], Value>(
  access: ProjectAccess,
  read: (partition: Partition, ...args: Arguments) => Promise<Value>,
): (
  principal: Principal,
  partition: Partition,
  ...args: Arguments
) => Promise<Value | undefined> {
  return async (principal, partition, ...args) =>
    (await access.authorize(principal, partition, "Read")) === undefined
      ? undefined
      : read(partition, ...args);
}

/** Authorizes before reading a value, including the distinction between denial and an empty page. */
export function authorizedProjectValue<Arguments extends unknown[], Value>(
  access: ProjectAccess,
  read: (partition: Partition, ...args: Arguments) => Promise<Value>,
): (
  principal: Principal,
  partition: Partition,
  ...args: Arguments
) => Promise<AuthorizedResult<Value>> {
  return async (principal, partition, ...args) => {
    const authority = await access.authorize(principal, partition, "Read");
    return authority === undefined
      ? { result: "NotFound" }
      : { result: "Authorized", value: await read(partition, ...args) };
  };
}

/** Supplies the granted authority to a mutation without catching authority outages. */
export async function authorizedProjectMutation<Value>(
  access: ProjectAccess,
  principal: Principal,
  partition: Partition,
  work: (authority: Authority) => Promise<Value>,
): Promise<AuthorizedResult<Value>> {
  const authority = await access.authorize(principal, partition, "Mutate");
  return authority === undefined
    ? { result: "NotFound" }
    : { result: "Authorized", value: await work(authority) };
}
