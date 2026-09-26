/**
 * A worker plane the suites drive the pod through, built from the contract's
 * own tables rather than written beside them. It resolves each request to the
 * route the contract names, holds it to naming the contract's release, reads
 * its body under that route's schema, and answers only a status that route's
 * map names, with a body the map's schema reads.
 *
 * A VIOLATION FAILS THE CASE THAT MADE IT, NOT ONLY THE REQUEST. The fetch
 * raises, but the transports retry a raising fetch and the callers catch what
 * the transports finally raise, so a malformed body could end a case exactly as
 * a refusal would. Each is also recorded, and every case in a file that loads
 * this module fails while any is.
 */

import { afterEach } from "node:test";
import { URL } from "node:url";

import {
  sessionCredentialSchema,
  sessionPlaneAnswers,
  sessionPlaneRoutes,
  sessionReferenceSchema,
  sessionTurnAnswerSchema,
  sessionTurnFailureSchema,
} from "@chuggy/worker-contract/sessionPlane";
import {
  contractVersionRefusalSchema,
  workerContractHeader,
  workerContractRelease,
  workerContractVersionOf,
  workerContractVersionText,
} from "@chuggy/worker-contract/workerContract";
import { resultManifestDocumentSchema } from "@chuggy/worker-contract/workerDocuments";
import {
  workerPlaneAnswers,
  workerPlaneBytesMediaType,
  workerPlaneRoutes,
  workerRunEndedSchema,
  workerRunTotalsSchema,
  workerRunTurnsSchema,
} from "@chuggy/worker-contract/workerPlane";
import { z } from "zod";

/**
 * Each wire: its routes, what each answers, the schema a route's JSON body is
 * read under, and the routes whose body is bytes.
 */
export const planes = {
  job: {
    routes: workerPlaneRoutes,
    answers: workerPlaneAnswers,
    bodies: {
      runTurns: workerRunTurnsSchema,
      runTotals: workerRunTotalsSchema,
      runEnded: workerRunEndedSchema,
      report: resultManifestDocumentSchema,
    },
    bytes: ["artifact", "runConfiguration", "runTranscript"],
  },
  session: {
    routes: sessionPlaneRoutes,
    answers: sessionPlaneAnswers,
    bodies: {
      reference: sessionReferenceSchema,
      turnAnswer: sessionTurnAnswerSchema,
      turnFailure: sessionTurnFailureSchema,
      credential: sessionCredentialSchema,
    },
    bytes: ["storeBatch"],
  },
};

const violations = [];

afterEach(() => {
  const seen = violations.splice(0);
  if (seen.length > 0)
    throw new Error(`the pod left the contract: ${seen.join("; ")}`);
});

function violated(message) {
  violations.push(message);
  return new Error(message);
}

/** The one route of `plane` a request asks for. */
export function routeOf(plane, method, pathname) {
  const matched = Object.entries(plane.routes).filter(
    ([, route]) =>
      route.method === method &&
      (route.path.endsWith("/*")
        ? pathname.startsWith(route.path.slice(0, -1)) &&
          pathname.length > route.path.length - 1
        : pathname === route.path),
  );
  if (matched.length !== 1)
    throw violated(`no one route answers ${method} ${pathname}`);
  return matched[0][0];
}

/** What a request offered, read as the route reads it. */
function offeredBody(plane, route, init) {
  const type = init.headers?.["content-type"];
  if (plane.bytes.includes(route)) {
    if (type !== workerPlaneBytesMediaType)
      throw violated(`${route} was offered ${String(type)}`);
    return init.body;
  }
  const schema = plane.bodies[route];
  if (init.body === undefined) {
    if (schema !== undefined) throw violated(`${route} was offered no body`);
    return undefined;
  }
  const body = JSON.parse(String(init.body));
  if (schema !== undefined && !schema.safeParse(body).success)
    throw violated(`${route} was offered ${String(init.body).slice(0, 200)}`);
  return body;
}

const served = workerContractVersionText(
  workerContractVersionOf(workerContractRelease),
);

/** The version refusal of a plane serving only the version this pod speaks. */
export const versionRefusal = contractVersionRefusalSchema.parse({
  action: "stop",
  reason: "UnsupportedContractVersion",
  accepted: { min: served, max: served },
});

/**
 * Every body `schema` reads for a refusal, one per body a status may carry: its
 * action, and the first reason it names where it names any.
 */
export function refusalBodies(schema) {
  if (schema instanceof z.ZodUnion)
    return schema.options.flatMap((option) => refusalBodies(option));
  if (schema === contractVersionRefusalSchema) return [versionRefusal];
  const { action, reason } = schema.shape;
  const reasons = (reason?.unwrap?.() ?? reason)?.options;
  return [
    schema.parse({
      ...(action === undefined ? {} : { action: action.value }),
      ...(reasons === undefined ? {} : { reason: reasons[0] }),
    }),
  ];
}

/** The refusal a status answers where a case names none: the route's own, where it has one beside the version refusal. */
function refusalBody(schema) {
  return refusalBodies(schema).at(-1);
}

/** The response one status of one route is, refused where the route's map does not name it. */
function answered(plane, route, status, body) {
  const schema = plane.answers[route][status];
  if (schema === undefined)
    throw violated(`${route} never answers ${String(status)}`);
  if (schema === "empty") {
    if (body !== undefined)
      throw violated(`${route} answers ${String(status)} with no body`);
    return new globalThis.Response(null, { status });
  }
  const sent = body ?? refusalBody(schema);
  if (!schema.safeParse(sent).success)
    throw violated(`${route} never answers ${String(status)} with that body`);
  return new globalThis.Response(JSON.stringify(sent), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A `fetch` for one wire. `answer(route, asked)` names the status and, for a
 * status whose body is not a refusal, the body.
 */
export function planeFetch(plane, answer) {
  const asked = [];
  return {
    asked,
    fetch: async (url, init = {}) => {
      const method = init.method ?? "GET";
      const { pathname, search } = new URL(url);
      const route = routeOf(plane, method, pathname);
      const release = init.headers?.[workerContractHeader];
      if (release !== workerContractRelease)
        throw violated(`${route} was asked under release ${String(release)}`);
      const body = offeredBody(plane, route, init);
      const request = { route, path: `${pathname}${search}`, method, body };
      asked.push(request);
      const { status, body: sent } = await answer(route, request);
      return answered(plane, route, status, sent);
    },
  };
}

/** One transport over a plane's `fetch`, its pauses taken at once. */
export function overPlane(transport, fetch) {
  return (task, bearer, path, init, options = {}) =>
    transport(task, bearer, path, init, {
      ...options,
      fetch,
      wait: async () => undefined,
    });
}
