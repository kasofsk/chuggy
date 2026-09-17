import { createHmac } from "node:crypto";

import type {
  AuthorityKind,
  IdempotencyKey,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";

export interface IdempotencyKeyVersion {
  readonly version: string;
  readonly secret: string;
}

export interface IdempotencyKeying {
  readonly current: string;
  readonly versions: readonly IdempotencyKeyVersion[];
}

export interface IdempotencyScope {
  readonly partition: Partition;
  readonly authorityKind: AuthorityKind;
}

function canonical(parts: readonly string[]): string {
  return parts
    .map((part) => `${String(Buffer.byteLength(part, "utf8"))}:${part}`)
    .join("");
}

export function idempotencyKeyDigestCurrent(
  keying: IdempotencyKeying,
  scope: IdempotencyScope,
  key: IdempotencyKey,
): string {
  const version = keying.versions.find(
    (item) => item.version === keying.current,
  );
  if (version === undefined)
    throw new Error(
      `postgres keying: version ${keying.current} is not one this process holds a secret for`,
    );
  return createHmac("sha256", version.secret)
    .update(
      canonical([
        "chuggy:idempotency:v1",
        "key",
        version.version,
        scope.partition.tenant,
        scope.partition.project,
        scope.authorityKind,
        key,
      ]),
    )
    .digest("hex");
}
