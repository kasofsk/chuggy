/**
 * The build's verdict on the chuggy server: that the runtime can list every tool
 * each roster admits, read off the built server rather than off the source.
 *
 * WHY A BUILD PROBE AND NOT A SUITE. The failure it catches is invisible from
 * inside this repo, which does not carry the agent runtime: a tool shape the
 * runtime's own JSON-schema converter cannot render makes the WHOLE listing
 * throw. The server still reports itself connected, `mcpServers` still names it,
 * and the model is simply told those tools do not exist — a lead that reads
 * nothing and decides nothing, with no error anywhere. It was a `z.record` that
 * did it the first time.
 *
 * IT RESOLVES THE RUNTIME THE WAY THE POD DOES, through `sessionSdk`, so what
 * is proved is the resolution a turn will make and not a second one written
 * beside it. That is what turns a missing peer dependency into a build failure.
 *
 * WHAT IT ASKS IS IN `./toolListing.mjs`, so that the asking is itself tested:
 * this file resolves the runtime and names the rosters, and nothing more.
 */

import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

import {
  chuggyToolContext,
  chuggyToolDefinitions,
  chuggyToolServer,
  sessionCapabilityTools,
} from "./chuggyTools.mjs";
import { leadDecisionStaging } from "./leadDecision.mjs";
import { sessionSdk } from "./session.mjs";
import { chuggyListedTools } from "./toolListing.mjs";

/**
 * The rosters probed, and why two. The lead's is written out — this file is
 * copied into the image, so it cannot read the suites' one copy of it — because
 * a lead is what this installation places today and a probe that only ever saw
 * the union would not notice the filter falling open. `every` is derived from
 * the image's own capability map rather than written a third time, so a tool
 * admitted by a capability no shipped roster carries yet — `create_draft` under
 * `DraftOriginate` — still has its shape rendered by the runtime's converter
 * here, which is where the failure this probe exists for would otherwise hide.
 */
const rosters = {
  lead: ["RepositoryRead", "ProjectRead", "DraftAuthor", "LeadDecision"],
  every: Object.keys(sessionCapabilityTools),
};

const { tool, createSdkMcpServer, z } = await sessionSdk();

for (const [roster, capabilities] of Object.entries(rosters)) {
  const context = chuggyToolContext(
    { tenant: "probe", project: "probe", api: { url: "http://127.0.0.1:1" } },
    "probe",
    { capabilities, staging: leadDecisionStaging() },
  );
  const admitted = chuggyToolDefinitions(context).map(({ name }) => name);
  const server = chuggyToolServer(context, { z, tool, createSdkMcpServer });

  const named = await chuggyListedTools(server, admitted, wait);

  process.stdout.write(
    `the chuggy server lists ${String(named.length)} tools for the ${roster} roster: ${named.join(" ")}\n`,
  );
}
