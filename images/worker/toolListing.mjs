/**
 * What the build's tool probe actually asks: drive one built chuggy server over
 * the runtime's own JSON-RPC transport, and hold what came back to what the
 * roster admitted.
 *
 * IT IS A MODULE AND NOT PART OF `toolProbe.mjs` SO A SUITE CAN DRIVE IT. The
 * probe resolves the real runtime, which this repo does not carry, so a probe
 * that kept its own check would be a build gate nothing tests — and the failure
 * this gate exists for is precisely one that presents as a clean, empty answer.
 * `toolListing.test.mjs` drives everything below against a stub server that
 * speaks the same transport, including the server that lists nothing.
 *
 * THE DIRECTION OF THE MEMBERSHIP CHECK IS THE WHOLE GATE. It asks whether
 * every ADMITTED tool is in the LISTING. The other direction — whether every
 * listed tool was admitted — is one the server cannot fail, because it lists
 * only what it was built from, so an empty listing would pass it. An empty
 * listing is the failure: a shape the runtime's JSON-schema converter cannot
 * render makes the whole listing throw, the server still reports itself
 * connected, and the model is told the tools do not exist.
 *
 * THE TRANSPORT IS WRITTEN HERE RATHER THAN IMPORTED. The runtime's server
 * speaks JSON-RPC over an object with `start`, `send` and `close`; supplying one
 * needs no client library, so nothing here turns a second peer dependency into a
 * build failure it would report as the first.
 */

/** How long one listing is waited for before it counts as no answer at all. */
export const chuggyListingWaitMs = 500;

const initializeId = 1;
const listId = 2;

/**
 * One built server's `tools/list`, over a transport this function supplies. The
 * answer is returned unjudged; `chuggyListingChecked` is what judges it.
 */
export async function chuggyListingAnswer(server, wait) {
  const answers = [];
  const transport = {
    async start() {},
    async send(message) {
      answers.push(message);
    },
    async close() {},
  };
  await server.instance.connect(transport);

  transport.onmessage({
    jsonrpc: "2.0",
    id: initializeId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe", version: "1" },
    },
  });
  transport.onmessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  transport.onmessage({
    jsonrpc: "2.0",
    id: listId,
    method: "tools/list",
    params: {},
  });
  await wait(chuggyListingWaitMs);
  return answers.find((answer) => answer.id === listId);
}

/**
 * The names the answer carries, or a raise naming what is wrong with it: no
 * answer, an error, an admitted tool the listing does not hold, or a tool whose
 * input schema is not the object a caller can build a call from.
 */
export function chuggyListingChecked(admitted, answer) {
  if (answer === undefined || answer.error !== undefined)
    throw new Error(
      `the chuggy server could not list its tools: ${JSON.stringify(answer?.error ?? "no answer")}`,
    );
  const tools = answer.result?.tools ?? [];
  const named = tools.map(({ name }) => name);
  const missing = admitted.filter((name) => !named.includes(name));
  if (missing.length > 0)
    throw new Error(`the chuggy server did not list ${missing.join(", ")}`);
  for (const listed of tools)
    if (listed.inputSchema?.type !== "object")
      throw new Error(`${listed.name} published no object input schema`);
  return named;
}

/** One server driven and judged: the tools it listed, or a raise saying why not. */
export async function chuggyListedTools(server, admitted, wait) {
  return chuggyListingChecked(
    admitted,
    await chuggyListingAnswer(server, wait),
  );
}
