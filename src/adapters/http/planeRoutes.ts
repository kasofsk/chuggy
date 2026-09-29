/**
 * How the job, session and pool planes serve a route: the plane's release
 * check, then the caller resolved from its bearer, both in `onRequest` hooks
 * that run before any byte of the body is read, and only then the body, read
 * under the most that one route takes. A request from anyone the plane does not
 * serve is refused without the plane buffering or parsing what it sent, and the
 * handler is handed the caller its hook resolved rather than resolving it again.
 */

import fastify, {
  errorCodes,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { nativeHttpBodyBytesMax } from "../../contract/http.ts";

/** The most of a body a plane reads where no route names its own bound, which is what an unrouted request is read under. */
export const planeBodyBytesDefault = nativeHttpBodyBytesMax;

/**
 * A plane's server, which takes an empty body with no media type as none
 * however it was framed and refuses any other body no parser takes. A proxy may
 * re-send a bodyless POST chunked, as the public tunnel does, and Fastify
 * refuses an untyped chunked body it has no parser for.
 */
export function planeApp(): FastifyInstance {
  const app = fastify({ logger: false, bodyLimit: planeBodyBytesDefault });
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (request, body, done) => {
      if (request.headers["content-type"] === undefined && body.length === 0)
        done(null, undefined);
      else done(new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE());
    },
  );
  return app;
}

/** The most one character weighs once JSON escapes it: past the basic plane, a surrogate pair written as two `\u` escapes. */
const jsonEscapedCharBytesMax = 12;

/** The most one object weighs apart from its texts: its braces, keys, separators, figures and roster labels. */
const jsonObjectFixedBytesMax = 1_024;

/** The most a JSON string of `chars` characters weighs: every character escaped, its quotes, and the comma after it. */
export function planeJsonTextBytesMax(chars: number): number {
  return chars * jsonEscapedCharBytesMax + 3;
}

/** The most one JSON object weighs whose texts are bounded by `texts`, which with none is what a route reading no body is sent. */
export function planeJsonObjectBytesMax(...texts: readonly number[]): number {
  return texts.reduce(
    (bytes, chars) => bytes + planeJsonTextBytesMax(chars),
    jsonObjectFixedBytesMax,
  );
}

/** One route as a plane serves it, `oversized` answering a body past its bound where the route's own answers name that refusal. */
export interface PlaneRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly bodyBytesMax: number;
  readonly released: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<FastifyReply | undefined>;
  readonly oversized?: (reply: FastifyReply) => FastifyReply;
}

/**
 * Serves `handler` at `route` for the caller `admitted` resolves, which answers
 * undefined only once it has sent the refusal. The caller is kept per request
 * for the handler, so each request is authenticated once.
 */
export function planeRouteServed<Caller extends object>(
  app: FastifyInstance,
  route: PlaneRoute,
  admitted: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<Caller | undefined>,
  handler: (
    request: FastifyRequest,
    reply: FastifyReply,
    caller: Caller,
  ) => Promise<unknown>,
): void {
  const callers = new WeakMap<FastifyRequest, Caller>();
  const oversized = route.oversized;
  app.route({
    method: route.method,
    url: route.url,
    bodyLimit: route.bodyBytesMax,
    onRequest: [
      route.released,
      async (request, reply) => {
        const caller = await admitted(request, reply);
        if (caller === undefined) return reply;
        callers.set(request, caller);
        return undefined;
      },
    ],
    ...(oversized === undefined
      ? {}
      : {
          errorHandler: (error, _request, reply) => {
            if (!(error instanceof errorCodes.FST_ERR_CTP_BODY_TOO_LARGE))
              throw error;
            void oversized(reply);
          },
        }),
    handler: async (request, reply) => {
      const caller = callers.get(request);
      if (caller === undefined)
        throw new Error("plane: a route was reached by no admitted caller");
      return handler(request, reply, caller);
    },
  });
}
