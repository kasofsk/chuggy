/**
 * The transport: a `node:http` server that reads a request into plain values,
 * hands them to the router, and writes back what it decided.
 *
 * NOTHING HERE DECIDES ANYTHING. It reads headers, bounds and reads the body,
 * and turns an answer into a status line — the routing, the identity and the
 * refusals are all one layer in, which is what lets every one of them be tested
 * without a socket.
 *
 * A FAILURE IS AN ANSWER, NOT AN EXIT. An unhandled rejection ends this process
 * under the policy the composition root leaves in place, so a request that
 * threw is caught here and answered; what must be allowed to end the process is
 * a drain the drive could not complete, and that failure never travels this
 * path.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { httpApiBody } from "./request.ts";
import {
  httpApiRouter,
  type HttpApiAnswer,
  type HttpApiDesk,
  type HttpApiRouter,
} from "./routes.ts";

/** The base a relative request target is resolved against, so the path is read without needing a host. */
const httpApiOrigin = "http://desk.invalid";

/** The JSON content type every answer this module writes for itself carries. */
const httpApiJsonType = "application/json; charset=utf-8";

/** One header as one value, a repeated header joined the way the transport presents it. */
function httpApiHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

/** The request read into plain values, and then whatever the router made of it. */
async function httpApiAnswer(
  route: HttpApiRouter,
  request: IncomingMessage,
): Promise<HttpApiAnswer> {
  const body = await httpApiBody(request);
  if (body.parsed === "Refused") {
    return {
      status: 413,
      headers: { "content-type": httpApiJsonType },
      body: JSON.stringify({ refused: "the body is too large", why: body.why }),
    };
  }
  return await route({
    method: request.method ?? "GET",
    path: new URL(request.url ?? "/", httpApiOrigin).pathname,
    authorization: httpApiHeader(request, "authorization"),
    cookie: httpApiHeader(request, "cookie"),
    accept: httpApiHeader(request, "accept"),
    contentType: httpApiHeader(request, "content-type") ?? "",
    body: body.value,
  });
}

/** One request end to end, a failure inside it becoming an answer rather than the end of the process. */
async function httpApiServe(
  route: HttpApiRouter,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let answer: HttpApiAnswer;
  try {
    answer = await httpApiAnswer(route, request);
  } catch (failure: unknown) {
    const why = failure instanceof Error ? failure.message : String(failure);
    answer = {
      status: 500,
      headers: { "content-type": httpApiJsonType },
      body: JSON.stringify({ refused: "the desk failed", why }),
    };
  }
  response.writeHead(answer.status, answer.headers);
  response.end(answer.body);
}

/** The desk as a server, ready to be listened on; what it is handed is what it serves. */
export function httpApi(desk: HttpApiDesk): Server {
  const route = httpApiRouter(desk);
  return createServer((request, response) => {
    void httpApiServe(route, request, response);
  });
}
