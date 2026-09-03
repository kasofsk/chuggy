import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import {
  asPrincipal,
  type NativeWeb,
} from "../../src/interpreter/nativeWeb.ts";
import { unreadableLeadReads } from "./leadReadFixtures.ts";

/**
 * A boundary method a suite does not serve. It raises rather than answering, so
 * a route reached by accident fails on the call instead of on an empty page —
 * which is the difference between a case that is wrong and a case that is
 * vacuous.
 */
function unserved(name: string): () => never {
  return () => {
    throw new Error(`${name}: this suite does not serve it`);
  };
}

/**
 * The five thread methods a suite that never asks for a thread still has to
 * supply, because the app takes one boundary and not five.
 */
export const unservedThreads: Pick<
  NativeWeb,
  "threads" | "thread" | "threadTranscript" | "openThread" | "sendThreadMessage"
> = {
  threads: unserved("threads"),
  thread: unserved("thread"),
  threadTranscript: unserved("thread transcript"),
  openThread: unserved("open thread"),
  sendThreadMessage: unserved("thread message"),
};

/**
 * The three inquiry methods a suite that never asks the lead still has to
 * supply, for the same reason: the app takes one boundary and not three.
 */
export const unservedLeadInquiries: Pick<
  NativeWeb,
  "leadInquiries" | "leadInquiry" | "askLead"
> = {
  leadInquiries: unserved("lead inquiries"),
  leadInquiry: unserved("lead inquiry"),
  askLead: unserved("ask lead"),
};

/**
 * Every method the app takes, none of them served. A suite spreads it and then
 * writes the few methods its own cases are about, so what a case exercises is
 * exactly what it wrote.
 */
export const unservedNativeWeb: Parameters<typeof createNativeHttpApp>[0] = {
  ...unservedThreads,
  ...unservedLeadInquiries,
  ...unreadableLeadReads(),
  cancel: unserved("cancel"),
  configuration: unserved("configuration"),
  configurations: unserved("configurations"),
  createConfiguration: unserved("create configuration"),
  importRepositoryConfigurations: unserved("import configurations"),
  createDraft: unserved("create draft"),
  initializeDraft: unserved("initialize draft"),
  deleteDraft: unserved("delete draft"),
  dispatchView: unserved("dispatch view"),
  draft: unserved("draft"),
  drafts: unserved("drafts"),
  notifications: unserved("notifications"),
  operation: unserved("operation"),
  project: unserved("project"),
  projectInventory: unserved("project inventory"),
  reviseDraft: unserved("revise draft"),
  submit: unserved("submit"),
  ticket: unserved("ticket"),
  ticketNativeActions: unserved("ticket native actions"),
  nativeActions: unserved("native actions"),
  execution: unserved("execution"),
  executions: unserved("executions"),
  operationalStatus: unserved("operational status"),
  selectorOperationalContext: unserved("selector operational context"),
  outputContent: unserved("output content"),
  runTurns: unserved("run turns"),
  runTranscript: unserved("run transcript"),
  runConfiguration: unserved("run configuration"),
};

/**
 * The app over one boundary, with the three ports every route suite supplies
 * the same way: a bearer that authenticates one token, a readiness that is
 * ready, and one installation. A suite about any of those composes its own.
 */
export function servedNativeHttpApp(
  web: Parameters<typeof createNativeHttpApp>[0],
) {
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: asPrincipal("issuer geoff") },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
  );
}
