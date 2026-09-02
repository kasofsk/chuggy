/**
 * The build's verdict on the chuggy server: that the runtime can list every tool
 * the roster admits, read off the built server rather than off the source.
 *
 * WHY A BUILD PROBE AND NOT A SUITE. The failure it catches is invisible from
 * inside this repo, which does not carry the agent runtime: a tool shape the
 * runtime's own JSON-schema converter cannot render makes the WHOLE listing
 * throw. The server still reports itself connected, `mcpServers` still names it,
 * and the model is simply told those tools do not exist — a lead that reads
 * nothing and decides nothing, with no error anywhere. It was a `z.record` that
 * did it the first time.
 *
 * THE TRANSPORT IS WRITTEN HERE RATHER THAN IMPORTED. The runtime's server
 * speaks JSON-RPC over an object with `start`, `send` and `close`; supplying one
 * needs no client library, so the probe does not turn a second peer dependency
 * into a build failure it would report as this one.
 */

import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

import {
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolServer,
} from "./chuggyTools.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";

const capabilities = [
  "RepositoryRead",
  "ProjectRead",
  "DraftAuthor",
  "LeadDecision",
];

const { tool, createSdkMcpServer } =
  await import("@anthropic-ai/claude-agent-sdk");
const { z } = await import("zod");

const context = chuggyToolContext(
  { tenant: "probe", project: "probe", api: { url: "http://127.0.0.1:1" } },
  "probe",
  { capabilities, staging: leadDecisionStaging() },
);
const admitted = chuggyToolDefinitions(context).map(({ name }) => name);
const server = chuggyToolServer(context, { z, tool, createSdkMcpServer });

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
  id: 1,
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
  id: 2,
  method: "tools/list",
  params: {},
});
await wait(500);

const listed = answers.find((answer) => answer.id === 2);
if (listed === undefined || listed.error !== undefined)
  throw new Error(
    `the chuggy server could not list its tools: ${JSON.stringify(listed?.error ?? "no answer")}`,
  );
const named = (listed.result?.tools ?? []).map(({ name }) => name);
const missing = admitted.filter((name) => !named.includes(name));
if (missing.length > 0)
  throw new Error(`the chuggy server did not list ${missing.join(", ")}`);
for (const listedTool of listed.result.tools)
  if (listedTool.inputSchema?.type !== "object")
    throw new Error(`${listedTool.name} published no object input schema`);
process.stdout.write(`the chuggy server lists ${String(named.length)} tools\n`);
