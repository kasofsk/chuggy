/**
 * The page a sign-in returns to: an HTTP listener on this machine that hands
 * each request to whoever decides the answer.
 *
 * It reads no body, and answers a page in the words of the console's own
 * catalog wherever the answer has one. Every answer closes its connection, so closing the listener waits
 * on answers under way and on nothing else.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";
import type {
  SetupAnswered,
  SetupHeard,
  SetupListenPort,
} from "../app/core/setupPorts.ts";
import { listenerPage, listenerPagePolicy } from "./listenerPage.ts";

const listenerBrand: Copy = { id: "setup-page-brand" };
const listenerNext: Copy = { id: "setup-page-next" };

function heardOf(request: IncomingMessage, host: string): SetupHeard {
  const url = new URL(request.url ?? "/", `http://${host}`);
  return {
    method: request.method ?? "",
    path: url.pathname,
    search: url.search,
  };
}

function answer(response: ServerResponse, answered: SetupAnswered): void {
  const page =
    answered.page === undefined
      ? undefined
      : listenerPage(
          copyTextEn(listenerBrand),
          copyTextEn(answered.page),
          copyTextEn(listenerNext),
        );
  response.writeHead(answered.status, {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    connection: "close",
    ...(page === undefined
      ? {}
      : {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": listenerPagePolicy,
        }),
    ...(answered.location === undefined ? {} : { location: answered.location }),
  });
  response.end(page ?? "");
}

function closed(server: Server, waitMs: number): Promise<void> {
  return new Promise<void>((done) => {
    const dropped = setTimeout(() => {
      server.closeAllConnections();
    }, waitMs);
    server.close(() => {
      clearTimeout(dropped);
      done();
    });
    server.closeIdleConnections();
  });
}

export const listen: SetupListenPort = (host, decide) =>
  new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      request.resume();
      Promise.resolve()
        .then(() => decide(heardOf(request, host)))
        .then(
          (answered) => {
            answer(response, answered);
          },
          () => {
            answer(response, { status: 500 });
          },
        );
    });
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the listener has no port"));
        return;
      }
      resolve({
        port: address.port,
        close: (waitMs) => closed(server, waitMs),
      });
    });
  });
