/**
 * The build probe's own check, driven against a stub server that speaks the
 * runtime's transport. The case that matters is the server that lists nothing:
 * that is what a shape the JSON-schema converter cannot render produces, and a
 * probe that passed it would be a build gate with nothing behind it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { chuggyListedTools, chuggyListingChecked } from "./toolListing.mjs";

/** Time, as the probe waits it: nothing here sleeps, and nothing here is slow. */
const wait = async () => undefined;

const objectSchema = { type: "object", properties: {} };

/**
 * A server that answers `tools/list` with exactly these tools, over the same
 * `instance.connect(transport)` the runtime's own server offers.
 */
function serverOf(tools, answer) {
  return {
    instance: {
      connect(transport) {
        transport.onmessage = (message) => {
          if (message.id !== 2) return;
          // Deferred, as the runtime's own server answers: a stub that sent
          // synchronously would leave `chuggyListingWaitMs` unobserved, and the
          // probe would read `no answer` where every case here was green.
          void Promise.resolve().then(() =>
            transport.send(
              answer ?? {
                jsonrpc: "2.0",
                id: 2,
                result: {
                  tools: tools.map((name) => ({
                    name,
                    inputSchema: objectSchema,
                  })),
                },
              },
            ),
          );
        };
      },
    },
  };
}

const admitted = ["read_ticket", "create_draft", "list_threads"];

test("a server that lists every admitted tool answers with their names", async () => {
  const named = await chuggyListedTools(serverOf(admitted), admitted, wait);

  assert.deepEqual(named, admitted);
});

test("a server that lists nothing is the failure this probe exists for", async () => {
  await assert.rejects(
    chuggyListedTools(serverOf([]), admitted, wait),
    /did not list read_ticket, create_draft, list_threads/u,
  );
});

test("a listing missing one admitted tool names the one it is missing", async () => {
  await assert.rejects(
    chuggyListedTools(
      serverOf(["read_ticket", "list_threads"]),
      admitted,
      wait,
    ),
    /did not list create_draft$/u,
  );
});

test("a listing carrying tools nothing admitted is not what is asked", async () => {
  const named = await chuggyListedTools(
    serverOf([...admitted, "read_lead"]),
    admitted,
    wait,
  );

  assert.ok(
    named.includes("read_lead"),
    "the check is the roster against the listing, not the listing against the roster",
  );
});

test("a server that answers an error, or nothing at all, could not list", async () => {
  await assert.rejects(
    chuggyListedTools(
      serverOf([], { jsonrpc: "2.0", id: 2, error: { code: -32_603 } }),
      admitted,
      wait,
    ),
    /could not list its tools/u,
  );
  const silent = {
    instance: {
      connect(transport) {
        transport.onmessage = () => undefined;
      },
    },
  };
  await assert.rejects(
    chuggyListedTools(silent, admitted, wait),
    /could not list its tools: "no answer"/u,
  );
});

test("a tool whose input schema is not an object is a tool nothing can call", async () => {
  const answer = {
    jsonrpc: "2.0",
    id: 2,
    result: {
      tools: [
        { name: "read_ticket", inputSchema: objectSchema },
        { name: "create_draft", inputSchema: { type: "string" } },
        { name: "list_threads", inputSchema: objectSchema },
      ],
    },
  };

  assert.throws(
    () => chuggyListingChecked(admitted, answer),
    /create_draft published no object input schema/u,
  );
});

test("a listing with no tools field at all is empty, not absent", async () => {
  assert.throws(
    () => chuggyListingChecked(admitted, { jsonrpc: "2.0", id: 2, result: {} }),
    /did not list read_ticket/u,
  );
});
