/**
 * The rig this suite is pointed at, and the moves every drill makes on it.
 *
 * Nothing here is a double: the browser is a real Chromium, the sign-in is a
 * real authorization code exchange against the issuer, and the cluster is
 * reached over the ssh an operator would use. Every wait is bounded and every
 * bound is named, so a drill that runs out of one says which.
 *
 * A RIG THAT CANNOT BE ASKED IS NOT A RIG WITH NOTHING RUNNING. `onRig` turns a
 * failed command into an error carrying `rigCouldNotRunPrefix`, so a wrong ssh
 * destination, a missing `kubectl` and a denied role all reach the report as
 * themselves; only a command that SUCCEEDED and answered nothing is a workload
 * at no replicas, which is the one thing a drill may skip on.
 *
 * THE WORKLOAD NAMES BELOW ARE THIS INSTALLATION'S. Most drills act on the
 * cluster rather than on the console — they terminate the listener, restart the
 * API, and ask whether the journalled actor and the selector are up — and none
 * of that can be said without naming what to act on. They are gathered here so
 * a rig that names its workloads differently is one edit rather than a search.
 *
 * A DRAFT IS THE CHANGE THE API MAKES ALONE. Releasing one is the journalled
 * actor's and running it is the selector's, so a drill about the stream creates,
 * revises and then deletes a draft: the frame is a real one off the durable
 * change log, and nothing but the API had to be up to produce it.
 */

import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test as base } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { nativeHttpMediaType } from "../../src/contract/http.ts";
import {
  configurationsResponseSchema,
  draftInitializationResponseSchema,
  draftResponseSchema,
} from "../../src/contract/responses.ts";
import { rigCouldNotRunPrefix } from "./verdict.ts";

const runCommand = promisify(execFile);

/** Where the console is, who signs in, which project, and how the cluster is reached. */
export interface RigEnvironment {
  readonly consoleUrl: string;
  readonly apiUrl: string;
  readonly user: string;
  readonly password: string;
  readonly tenant: string;
  readonly project: string;
  readonly ssh: string;
  readonly evidenceDir: string;
}

/** What every intent this suite writes begins with, so its residue is identifiable. */
export const acceptanceIntentPrefix = "rig acceptance";

/** How long one live frame may take to be drawn, which bounds every liveness assertion. */
export const frameTimeoutMs = 30_000;

/** How long a submitted mutation may take to settle and navigate. */
export const mutationTimeoutMs = 90_000;

/** How long a sign-in through the issuer may take, redirects included. */
export const signInTimeoutMs = 90_000;

/** How long a killed listener or a restarted pod may take to be live again. */
export const recoveryTimeoutMs = 180_000;

/** How long one command on the rig may run before it is abandoned. */
export const rigCommandTimeoutMs = 60_000;

/** How many times a read across a restart is tried, and how long it waits between. */
export const restartAttemptsMax = 20;
export const restartAttemptWaitMs = 3_000;

/** The namespace the installation runs in, and what a drill acts on inside it. */
export const rigNamespace = "chuggy";
export const rigDeploymentKind = "deployment";
export const rigApiDeployment = "chuggy-api";
export const rigActorDeployment = "chuggy-ticket-service";
export const rigSelectorDeployment = "chuggy-selector";
export const rigDatabasePod = "postgres-0";
export const rigDatabase = "chuggy";

/** The environment name a deployment raises the stream cap with. */
export const streamConnectionsVariable = "CHUG_API_STREAM_CONNECTIONS_MAX";

/** The one session the API listens for its doorbell on, named as its own query states it. */
export const listenerTerminationQuery =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query='LISTEN chuggy_project_change'";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(
      `${name} is required; \`just acceptance\` names the whole set`,
    );
  return value;
}

function environment(): RigEnvironment {
  return {
    consoleUrl: required("CHUG_RIG_CONSOLE_URL").replace(/\/+$/u, ""),
    apiUrl: required("CHUG_RIG_API_URL").replace(/\/+$/u, ""),
    user: required("CHUG_RIG_USER"),
    password: required("CHUG_RIG_PASSWORD"),
    tenant: required("CHUG_RIG_TENANT"),
    project: required("CHUG_RIG_PROJECT"),
    ssh: required("CHUG_RIG_SSH"),
    evidenceDir:
      process.env["CHUG_RIG_EVIDENCE_DIR"] ??
      join(tmpdir(), "chuggy-rig-acceptance"),
  };
}

export const rig = environment();

/** The project's own address, which every drill starts from. */
export function projectUrl(): string {
  return `${rig.consoleUrl}/${rig.tenant}/${rig.project}`;
}

/** Where this project's resources are, under the API root the environment names. */
function projectPath(): string {
  return `/tenants/${rig.tenant}/projects/${rig.project}`;
}

/** One argument, quoted for the single round of shell parsing ssh puts it through. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function couldNotAsk(command: readonly string[], failure: unknown): Error {
  const said =
    failure instanceof Error && "stderr" in failure
      ? failure.stderr
      : undefined;
  const detail = typeof said === "string" && said.trim().length > 0 ? said : "";
  return new Error(
    `${rigCouldNotRunPrefix}: ${command.join(" ")}${detail === "" ? "" : ` — ${detail.trim()}`}`,
  );
}

/** One command on the rig, over ssh, bounded; a command that failed is not an answer. */
export async function onRig(command: readonly string[]): Promise<string> {
  try {
    const done = await runCommand(
      "ssh",
      [rig.ssh, command.map(quoted).join(" ")],
      { timeout: rigCommandTimeoutMs },
    );
    return done.stdout;
  } catch (failure: unknown) {
    throw couldNotAsk(command, failure);
  }
}

/** Whether one deployment has a replica up, asked of a cluster that answered. */
export async function deploymentReady(name: string): Promise<boolean> {
  const replicas = await onRig([
    "kubectl",
    "-n",
    rigNamespace,
    "get",
    rigDeploymentKind,
    name,
    "-o",
    "jsonpath={.status.readyReplicas}",
  ]);
  return Number(replicas.trim()) > 0;
}

/** Which generation of the API is deployed, which a restart is what changes. */
export async function apiRevision(): Promise<string> {
  const said = await onRig([
    "kubectl",
    "-n",
    rigNamespace,
    "get",
    rigDeploymentKind,
    rigApiDeployment,
    "-o",
    "jsonpath={.metadata.annotations.deployment\\.kubernetes\\.io/revision}",
  ]);
  return said.trim();
}

/** How many streams this API will hold open, which the deployment may raise. */
export async function streamConnectionsMax(whenUnset: number): Promise<number> {
  const said = await onRig([
    "kubectl",
    "-n",
    rigNamespace,
    "get",
    rigDeploymentKind,
    rigApiDeployment,
    "-o",
    `jsonpath={.spec.template.spec.containers[0].env[?(@.name=="${streamConnectionsVariable}")].value}`,
  ]);
  const named = Number(said.trim());
  return Number.isSafeInteger(named) && named > 0 ? named : whenUnset;
}

/** Terminates every backend holding the doorbell, answering how many it ended. */
export async function terminateListener(): Promise<number> {
  const said = await onRig([
    "kubectl",
    "-n",
    rigNamespace,
    "exec",
    rigDatabasePod,
    "--",
    "psql",
    "-U",
    "postgres",
    "-d",
    rigDatabase,
    "-tAc",
    listenerTerminationQuery,
  ]);
  return said.split("\n").filter((line) => line.trim().length > 0).length;
}

/** A screenshot named for the claim it stands behind, kept outside the tree. */
export async function evidence(page: Page, name: string): Promise<void> {
  await mkdir(rig.evidenceDir, { recursive: true });
  await page.screenshot({
    path: join(rig.evidenceDir, `${name}.png`),
    fullPage: true,
  });
}

/** The section panel a screen draws under one heading. */
export function panel(page: Page, title: string): Locator {
  return page.locator("section.panel", {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

/** The link a ticket number is drawn as wherever a table of tickets appears. */
export function ticketLink(within: Locator, ticket: number): Locator {
  return within.getByRole("link", { name: String(ticket), exact: true });
}

/** The banner the shell draws only while what the screens show is not arriving live. */
export function notLiveBanner(page: Page): Locator {
  return page.locator(".banner");
}

/** The intent the brief panel draws, which is what a `Draft` frame rewrites. */
export function briefIntent(page: Page): Locator {
  return page.locator("p.intent");
}

/** The count beside the inbox link, absent rather than zero when nothing needs a human. */
export function inboxBadge(page: Page): Locator {
  return page.locator(".nav-count");
}

/** What the badge says now, an absent badge being none rather than unread. */
export async function inboxCount(page: Page): Promise<number> {
  const badge = inboxBadge(page);
  if ((await badge.count()) === 0) return 0;
  return Number.parseInt(await badge.innerText(), 10);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto(`${rig.consoleUrl}/`);
  await page
    .getByRole("button", { name: "sign in" })
    .click({ timeout: signInTimeoutMs });
  const identifier = page.locator('input[name="identifier"]');
  await identifier.waitFor({ timeout: signInTimeoutMs });
  await identifier.fill(rig.user);
  await page.locator('input[name="password"]').fill(rig.password);
  await page.locator('button[name="method"][value="password"]').click();
  await expect(page.locator(".brand")).toHaveText("chuggy", {
    timeout: signInTimeoutMs,
  });
}

/**
 * A stream that has opened and is carrying changes. The banner is drawn while a
 * stream is still opening as well as when one has failed, so a drill that did
 * not wait here would find its "not live" already on screen.
 */
export async function awaitLive(page: Page): Promise<void> {
  await expect(notLiveBanner(page)).toHaveCount(0, {
    timeout: recoveryTimeoutMs,
  });
}

export async function openProject(page: Page): Promise<void> {
  await page.goto(projectUrl());
  await expect(panel(page, "up next")).toBeVisible({ timeout: frameTimeoutMs });
  await awaitLive(page);
}

/**
 * One ticket's own page, drawn but not waited on for a stream. A drill that
 * refuses the stream on purpose starts here, because the page is readable
 * without one and that is half of what it is checking.
 */
export async function openTicketPage(
  page: Page,
  ticket: number,
): Promise<void> {
  await page.goto(`${projectUrl()}/tickets/${String(ticket)}`);
  await expect(panel(page, "brief")).toBeVisible({ timeout: frameTimeoutMs });
}

/** The same page, live, which is where every drill but the fallback one starts. */
export async function openTicket(page: Page, ticket: number): Promise<void> {
  await openTicketPage(page, ticket);
  await awaitLive(page);
}

/** The address the console opens its event stream at, which a drill may refuse. */
export function isStreamRequest(url: URL): boolean {
  return url.pathname.endsWith("/events");
}

const ticketPathPattern = /\/tickets\/(\d+)$/u;

/**
 * One ticket, created and released from the console's own form. The dependency
 * is chosen behind the disclosure, which is where everything a person is not
 * asked about lives.
 */
export async function createTicket(
  page: Page,
  intent: string,
  dependsOn?: number,
): Promise<number> {
  await page.goto(`${projectUrl()}/tickets/new`);
  await page
    .getByPlaceholder("what this ticket is for")
    .fill(`${acceptanceIntentPrefix}, ${intent}`, { timeout: frameTimeoutMs });
  if (dependsOn !== undefined) {
    await page.getByText("advanced", { exact: true }).click();
    await page
      .getByLabel(`ticket ${String(dependsOn)}`, { exact: true })
      .check();
  }
  await page.getByRole("button", { name: "create and release" }).click();
  await page.waitForURL(ticketPathPattern, { timeout: mutationTimeoutMs });
  const found = ticketPathPattern.exec(new URL(page.url()).pathname);
  const ticket = found?.[1];
  if (ticket === undefined)
    throw new Error(
      `the address after creation names no ticket: ${page.url()}`,
    );
  return Number(ticket);
}

async function apiCall(
  bearer: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const written =
    body === undefined ? {} : { "content-type": nativeHttpMediaType };
  const answered = await fetch(`${rig.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: nativeHttpMediaType,
      ...written,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const said = await answered.text();
  if (!answered.ok)
    throw new Error(
      `${method} ${path} answered ${String(answered.status)}: ${said}`,
    );
  return said.length === 0 ? undefined : JSON.parse(said);
}

/** The ordinary read a drill asks for while it is holding streams or a doorbell down. */
export async function readProjectStatus(bearer: string): Promise<number> {
  const answered = await fetch(`${rig.apiUrl}${projectPath()}?limit=1`, {
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: nativeHttpMediaType,
    },
  });
  return answered.status;
}

/** The newest ready revision this project has, which is what shapes a draft. */
async function readyRevision(bearer: string): Promise<string> {
  const answered = configurationsResponseSchema.parse(
    await apiCall(bearer, "GET", `${projectPath()}/configurations?limit=50`),
  );
  const ready = answered.configurations.find(
    (summary) => summary.readiness === "Ready",
  );
  if (ready === undefined)
    throw new Error(
      `${rig.tenant}/${rig.project} has no ready configuration to shape a draft with`,
    );
  return ready.revision;
}

function draftPath(ticket: number): string {
  return `${projectPath()}/drafts/${String(ticket)}`;
}

/** One draft, created through the API and left unreleased for a drill to change. */
export async function createDraft(
  bearer: string,
  intent: string,
): Promise<number> {
  const revision = await readyRevision(bearer);
  const initialized = draftInitializationResponseSchema.parse(
    await apiCall(
      bearer,
      "GET",
      `${projectPath()}/draft-initializations/${revision}`,
    ),
  );
  const created = draftResponseSchema.parse(
    await apiCall(bearer, "POST", `${projectPath()}/drafts`, {
      configurationRevision: revision,
      configurationDigest: initialized.fence.configurationDigest,
      expectedProjectSequence: initialized.fence.projectSequence,
      authoring: initialized.defaults,
      brief: { intent: `${acceptanceIntentPrefix}, ${intent}`, links: [] },
    }),
  );
  return created.ticket;
}

/** A draft's intent, rewritten through the API, which appends one `Draft` change. */
export async function reviseDraftIntent(
  bearer: string,
  ticket: number,
  intent: string,
): Promise<string> {
  const path = draftPath(ticket);
  const written = `${acceptanceIntentPrefix}, ${intent}`;
  const draft = draftResponseSchema.parse(await apiCall(bearer, "GET", path));
  await apiCall(bearer, "PUT", path, {
    expectedVersion: draft.authoringVersion,
    configurationRevision: draft.configurationRevision,
    authoring: draft.authoring,
    brief: { links: [], ...draft.brief, intent: written },
  });
  return written;
}

/** The draft a drill made, taken back, so a run leaves the project as it found it. */
export async function deleteDraft(
  bearer: string,
  ticket: number,
): Promise<void> {
  const path = draftPath(ticket);
  const draft = draftResponseSchema.parse(await apiCall(bearer, "GET", path));
  await apiCall(
    bearer,
    "DELETE",
    `${path}?expectedVersion=${String(draft.authoringVersion)}`,
  );
}

/**
 * The same call across an API that is being replaced. A rolling restart takes
 * one reply's connection with it, so a bounded retry is what separates that
 * from an API that never came back.
 */
export async function throughRestart<T>(call: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < restartAttemptsMax; attempt += 1) {
    try {
      return await call();
    } catch (failure: unknown) {
      last = failure;
      await new Promise((resolve) => setTimeout(resolve, restartAttemptWaitMs));
    }
  }
  throw last instanceof Error
    ? last
    : new Error("the call did not answer across the restart");
}

/** Streams held open against the API, and the one way to let them go. */
export interface HeldStreams {
  readonly connected: number;
  readonly close: () => void;
}

function streamProcess(bearer: string): ChildProcess {
  return spawn(
    "curl",
    [
      "-sS",
      "-N",
      "--http1.1",
      "-H",
      `authorization: Bearer ${bearer}`,
      "-H",
      "accept: text/event-stream",
      `${rig.apiUrl}${projectPath()}/events`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
}

/** The frame a fresh stream opens with, which is what makes one connected. */
export const streamOpeningFrame = "event: ready";

/**
 * As many event streams as asked for, each one its own connection, counted by
 * the opening frame each answered with. A refusal has a body too, so bytes
 * alone would count a stream the API never opened.
 */
export async function holdStreams(
  bearer: string,
  count: number,
  settleMs: number,
): Promise<HeldStreams> {
  const held: ChildProcess[] = [];
  const answered = new Set<number>();
  for (let opened = 0; opened < count; opened += 1) {
    const child = streamProcess(bearer);
    const at = opened;
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes(streamOpeningFrame)) answered.add(at);
    });
    held.push(child);
  }
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return {
    connected: answered.size,
    close: () => {
      for (const child of held) child.kill("SIGKILL");
    },
  };
}

/** What the console is sending as its bearer, taken from the requests it makes. */
function bearerWatch(page: Page): () => string {
  let held: string | undefined;
  page.on("request", (request) => {
    const authorization = request.headers()["authorization"];
    if (authorization !== undefined && authorization.startsWith("Bearer "))
      held = authorization.slice("Bearer ".length);
  });
  return () => {
    if (held === undefined)
      throw new Error("the console has sent no bearer to read");
    return held;
  };
}

/** A signed-in tab and the bearer it is sending, which is all any drill starts with. */
export interface SignedIn {
  readonly page: Page;
  readonly bearer: () => string;
}

export const drill = base.extend<{ readonly signedIn: SignedIn }>({
  signedIn: async ({ page }, use) => {
    const bearer = bearerWatch(page);
    await signIn(page);
    await use({ page, bearer });
  },
});
