/**
 * The chuggy HTTP wire as a browser sees it: request descriptors in, a closed
 * set of outcomes out.
 *
 * Nothing here performs a request. The wire constants restate the server's own
 * because a static artifact cannot import its TypeScript, and
 * `test/ui/protocol.test.ts` holds the two copies equal. Every 400 the server
 * emits is the same opaque code, so the bounds below are checked here instead.
 */

export const mediaType = "application/vnd.chuggy.v1+json";
export const basePath = "/api/v1";
export const pageLimitMax = 100;
export const pageLimitDefault = 50;
export const cursorCharsMax = 2_048;
export const pathSegmentCharsMax = 256;
export const bodyBytesMax = 65_536;
export const retryAfterSecondsMax = 300;
export const retryAfterSecondsFallback = 5;

/** @typedef {{ readonly tenant: string, readonly project: string }} Partition */

/** @typedef {readonly (readonly [string, string])[]} QueryFields */

/**
 * @typedef {object} ApiRequest
 * @property {"GET" | "POST" | "DELETE"} method
 * @property {string} url
 * @property {Record<string, string>} headers
 * @property {string} [body]
 */

/**
 * @typedef {{ outcome: "Ok", body: unknown }
 *   | { outcome: "Accepted", body: unknown, location: string | undefined }
 *   | { outcome: "Unauthenticated" }
 *   | { outcome: "Absent" }
 *   | { outcome: "Conflict", code: string, body: unknown }
 *   | { outcome: "Retryable", code: string, retryAfterSeconds: number }
 *   | { outcome: "Rejected", code: string, status: number, body: unknown }
 *   | { outcome: "Fault", code: string, status: number }} ApiOutcome
 */

/**
 * The path prefix every project-scoped resource hangs from.
 *
 * @param {Partition} partition
 */
export function partitionPath(partition) {
  const tenant = encodeURIComponent(partition.tenant);
  const project = encodeURIComponent(partition.project);
  if (
    tenant.length > pathSegmentCharsMax ||
    project.length > pathSegmentCharsMax
  )
    throw new RangeError(
      "a partition segment is longer than the server accepts",
    );
  return `${basePath}/tenants/${tenant}/projects/${project}`;
}

/** @param {number} limit */
function checkedLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > pageLimitMax)
    throw new RangeError("a page limit is outside the server's range");
  return String(limit);
}

/** @param {string} cursor */
function checkedCursor(cursor) {
  if (cursor.length === 0 || cursor.length > cursorCharsMax)
    throw new RangeError("a cursor is empty or longer than the server accepts");
  return cursor;
}

/**
 * @param {string} name
 * @param {string | number | undefined} value
 * @returns {QueryFields}
 */
function optionalField(name, value) {
  return value === undefined ? [] : [[name, String(value)]];
}

/**
 * @param {string} accessToken
 * @param {string} path
 * @param {QueryFields} query
 * @returns {ApiRequest}
 */
function readRequest(accessToken, path, query) {
  const search = new URLSearchParams(query.map((pair) => [...pair])).toString();
  return {
    method: /** @type {const} */ ("GET"),
    url: search.length === 0 ? path : `${path}?${search}`,
    headers: { accept: mediaType, authorization: `Bearer ${accessToken}` },
  };
}

/**
 * Page one omits the cursor; every later page carries the one the server gave.
 *
 * @param {string} accessToken
 * @param {string | undefined} cursor
 * @param {number} limit
 */
export function projectsRequest(accessToken, cursor, limit) {
  return readRequest(accessToken, `${basePath}/projects`, [
    ...optionalField(
      "cursor",
      cursor === undefined ? undefined : checkedCursor(cursor),
    ),
    ["limit", checkedLimit(limit)],
  ]);
}

/**
 * The phase filter is the server's, not the console's: `NonTerminal` names a
 * selection the domain owns, and a phase list is sent one field per phase.
 *
 * @param {{ selection: "All" } | { selection: "NonTerminal" }
 *   | { selection: "Selected", phases: readonly string[] }} filter
 * @returns {QueryFields}
 */
export function phaseQuery(filter) {
  if (filter.selection === "All") return [];
  if (filter.selection === "NonTerminal") return [["phase", "NonTerminal"]];
  return filter.phases.map((phase) => [/** @type {const} */ ("phase"), phase]);
}

/**
 * `minimumSequence` is how a caller reads its own writes; unmet, it answers 409.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {{ after?: number, limit: number, minimumSequence?: number,
 *   phases?: QueryFields }} query
 */
export function ticketsRequest(accessToken, partition, query) {
  return readRequest(accessToken, `${partitionPath(partition)}/tickets`, [
    ...optionalField("after", query.after),
    ["limit", checkedLimit(query.limit)],
    ...optionalField("minimumSequence", query.minimumSequence),
    ...(query.phases ?? []),
  ]);
}

/**
 * Configuration pages are newest-first and continue with an opaque cursor.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {string | undefined} cursor
 * @param {number} limit
 */
export function configurationsRequest(accessToken, partition, cursor, limit) {
  return readRequest(
    accessToken,
    `${partitionPath(partition)}/configurations`,
    [
      ...optionalField(
        "cursor",
        cursor === undefined ? undefined : checkedCursor(cursor),
      ),
      ["limit", checkedLimit(limit)],
    ],
  );
}

/**
 * Repository imports name an immutable Git object, never a moving ref.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {string} commit
 * @returns {ApiRequest}
 */
export function repositoryConfigurationImportRequest(
  accessToken,
  partition,
  commit,
) {
  const body = JSON.stringify({ commit });
  if (body.length > bodyBytesMax)
    throw new RangeError("an import body is larger than the server accepts");
  return {
    method: /** @type {const} */ ("POST"),
    url: `${partitionPath(partition)}/configurations/imports`,
    headers: {
      accept: mediaType,
      authorization: `Bearer ${accessToken}`,
      "content-type": mediaType,
    },
    body,
  };
}

/**
 * Page one pins the watermark so the remaining pages share one snapshot.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {{ after?: number, limit: number, watermark?: number }} query
 */
export function dispatchViewRequest(accessToken, partition, query) {
  return readRequest(accessToken, `${partitionPath(partition)}/dispatch-view`, [
    ...optionalField("after", query.after),
    ["limit", checkedLimit(query.limit)],
    ...optionalField("watermark", query.watermark),
  ]);
}

/**
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {number} after
 * @param {number} limit
 */
export function notificationsRequest(accessToken, partition, after, limit) {
  return readRequest(accessToken, `${partitionPath(partition)}/notifications`, [
    ["after", String(after)],
    ["limit", checkedLimit(limit)],
  ]);
}

/**
 * The scheduler's own counts, read at request time and carrying whatever
 * freshness the scheduler is willing to claim for them.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 */
export function operationalStatusRequest(accessToken, partition) {
  const path = `${partitionPath(partition)}/operational-status`;
  return readRequest(accessToken, path, []);
}

/**
 * `NonTerminal` is the selection an operator watches; a state list is sent one
 * field per state.
 *
 * @param {{ selection: "All" } | { selection: "NonTerminal" }
 *   | { selection: "Selected", states: readonly string[] }} filter
 * @returns {QueryFields}
 */
export function executionStateQuery(filter) {
  if (filter.selection === "All") return [];
  if (filter.selection === "NonTerminal") return [["state", "NonTerminal"]];
  return filter.states.map((state) => [/** @type {const} */ ("state"), state]);
}

/**
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {{ after?: string, limit: number, states?: QueryFields }} query
 */
export function executionsRequest(accessToken, partition, query) {
  return readRequest(accessToken, `${partitionPath(partition)}/executions`, [
    ...optionalField("after", query.after),
    ["limit", checkedLimit(query.limit)],
    ...(query.states ?? []),
  ]);
}

/**
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {string} execution
 */
export function executionRequest(accessToken, partition, execution) {
  const root = `${partitionPath(partition)}/executions`;
  return readRequest(
    accessToken,
    `${root}/${encodeURIComponent(execution)}`,
    [],
  );
}

/**
 * One declared output of a completed execution, addressed by its ordinal in the
 * result manifest rather than by any path.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {string} execution
 * @param {number} ordinal
 */
export function artifactRequest(accessToken, partition, execution, ordinal) {
  const root = `${partitionPath(partition)}/executions`;
  const path = `${root}/${encodeURIComponent(execution)}/artifacts/${String(ordinal)}`;
  return readRequest(accessToken, path, []);
}

/**
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {string} operation
 */
export function operationRequest(accessToken, partition, operation) {
  const root = `${partitionPath(partition)}/operations`;
  return readRequest(
    accessToken,
    `${root}/${encodeURIComponent(operation)}`,
    [],
  );
}

/**
 * A submission without the idempotency key is a 400 the server will not explain.
 *
 * @param {string} accessToken
 * @param {Partition} partition
 * @param {{ operation: string, idempotencyKey: string, mutation: unknown }} submission
 * @returns {ApiRequest}
 */
export function submissionRequest(accessToken, partition, submission) {
  const body = JSON.stringify({
    operation: submission.operation,
    mutation: submission.mutation,
  });
  if (body.length > bodyBytesMax)
    throw new RangeError("a submission body is larger than the server accepts");
  return {
    method: /** @type {const} */ ("POST"),
    url: `${partitionPath(partition)}/operations`,
    headers: {
      accept: mediaType,
      authorization: `Bearer ${accessToken}`,
      "content-type": mediaType,
      "idempotency-key": submission.idempotencyKey,
    },
    body,
  };
}

/**
 * @param {unknown} body
 * @param {string} fallback
 */
function envelopeCode(body, fallback) {
  if (typeof body !== "object" || body === null) return fallback;
  const error = /** @type {Record<string, unknown>} */ (body)["error"];
  if (typeof error !== "object" || error === null) return fallback;
  const code = /** @type {Record<string, unknown>} */ (error)["code"];
  return typeof code === "string" && code.length > 0 ? code : fallback;
}

/**
 * A hostile or absent `retry-after` becomes a delay the console can still bound.
 *
 * @param {string | null | undefined} header
 */
export function retryAfterSeconds(header) {
  if (header === undefined || header === null) return retryAfterSecondsFallback;
  const parsed = Number(header.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return retryAfterSecondsFallback;
  return Math.min(Math.ceil(parsed), retryAfterSecondsMax);
}

/**
 * Absent and inaccessible are one outcome because the server makes them one;
 * the console must never render a third.
 *
 * @param {number} status
 * @param {(name: string) => string | null | undefined} header
 * @param {unknown} body
 * @returns {ApiOutcome}
 */
export function classify(status, header, body) {
  if (status === 202)
    return {
      outcome: "Accepted",
      body,
      location: header("location") ?? undefined,
    };
  if (status >= 200 && status < 300) return { outcome: "Ok", body };
  if (status === 401) return { outcome: "Unauthenticated" };
  if (status === 404) return { outcome: "Absent" };
  if (status === 409)
    return { outcome: "Conflict", code: envelopeCode(body, "Conflict"), body };
  if (status === 429 || status === 503)
    return {
      outcome: "Retryable",
      code: envelopeCode(body, "Retryable"),
      retryAfterSeconds: retryAfterSeconds(header("retry-after")),
    };
  if (status >= 400 && status < 500)
    return {
      outcome: "Rejected",
      code: envelopeCode(body, "InvalidRequest"),
      status,
      body,
    };
  return {
    outcome: "Fault",
    code: envelopeCode(body, "InternalError"),
    status,
  };
}
