/**
 * The surface `toolServer.ts` imports from the core, which ships untyped
 * modules: what each export is called with and answers, as
 * `hostedTools.mjs` documents and its own suite drives it.
 */
declare module "@chuggy/worker-core/hostedTools.mjs" {
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import type { z } from "zod";

  const hostedToolContextBrand: unique symbol;

  /** The tools' context for one request, which only `hostedToolServer` reads. */
  export interface HostedToolContext {
    readonly [hostedToolContextBrand]: true;
  }

  /** `site` is the origin named as the server's website, `api` the base URL the tools call, and `bearer` the one the host verified. */
  export function hostedToolContext(input: {
    readonly site: string;
    readonly api: string;
    readonly version: string;
    readonly bearer: string;
  }): HostedToolContext;

  /** The server for one request, every tool registered and nothing connected. */
  export function hostedToolServer(
    context: HostedToolContext,
    sdk: { readonly McpServer: typeof McpServer; readonly z: typeof z },
  ): McpServer;
}
