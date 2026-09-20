/**
 * The token an owner mints for a machine they are about to register, and what
 * redeeming it comes to.
 *
 * IT IS THE SHAPE A RUNNER REGISTRATION ALREADY HAS. An owner cannot be present
 * at every machine, and a machine cannot be trusted to name its own project, so
 * the owner mints a short-lived single-use token scoped to one partition and the
 * operator configures the machine with it. Redeeming it is the only path by
 * which anything but an owner's own command causes a client to exist.
 *
 * WHAT IT BOUNDS IS THE CAPABILITY CLAIM. A pool's capabilities are otherwise
 * unverifiable — a token is a string a machine asserts about itself — and the
 * one party who knows what machine is about to be registered is the owner
 * minting the token. So a redemption may declare any subset of what the token
 * permits and nothing outside it, and a token minted for Linux containers
 * cannot register a pool claiming macOS.
 *
 * THE TOKEN IS READ BEFORE IT IS SPENT. Consuming it and then refusing the
 * capabilities would burn an owner's token on an operator's typo, so what the
 * token permits is read first and the consuming update is still the only thing
 * that decides single use — a second redeemer racing the first is answered by
 * that update and by nothing here. A fault after the spend — an issuer or an
 * authority that could not answer — gives the token back before it is raised,
 * so an outage costs the operator a retry and not the owner a token; what
 * stays spent is a redemption that was answered.
 */

import { assertNever } from "../domain/assertNever.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import type { WorkerPoolClientSecret } from "./workerPool.ts";
import {
  workerPoolRegisteredAt,
  type RegisterPoolPorts,
} from "./workerPoolRegistration.ts";

/** What a token permits, as the durable side answers a caller holding one. */
export interface WorkerPoolRegistrationTokenTerms {
  readonly partition: Partition;
  readonly capabilities: readonly string[];
}

/** The most tokens one project may have outstanding for redemption at once. */
export const workerPoolTokensLiveMax = 16;

/** What one mint wrote: a row, nothing because no active project was named, or nothing because the project is at its bound. */
export type WorkerPoolTokenWritten = "Minted" | "NotFound" | "LimitReached";

/**
 * The durable side of a token's whole life. `mint` writes a row only under the
 * project's bound and sweeps that project's expired tokens as it does, `permitted` reads a token that is neither spent nor expired, `consume`
 * is the single write that spends it, so nothing but that write decides which
 * of two redeemers won, and `restore` gives back an unexpired one whose
 * redemption faulted.
 */
export interface WorkerPoolRegistrationTokens {
  mint(
    partition: Partition,
    digest: string,
    capabilities: readonly string[],
    expiresAtMs: number,
  ): Promise<WorkerPoolTokenWritten>;
  permitted(
    digest: string,
  ): Promise<WorkerPoolRegistrationTokenTerms | undefined>;
  consume(
    digest: string,
  ): Promise<WorkerPoolRegistrationTokenTerms | undefined>;
  restore(digest: string): Promise<boolean>;
}

/**
 * What minting for a caller came to. An authority that could not answer is not
 * an arm here: it throws `ProjectAccessUnavailable`, which the boundary already
 * answers 503 with, so a refusal and an outage cannot be merged by accident.
 */
export type WorkerPoolTokenMinted =
  | { readonly result: "NotFound" }
  | { readonly result: "LimitReached" }
  | {
      readonly result: "Minted";
      readonly value: { readonly token: string; readonly expiresAtMs: number };
    };

/** What redeeming came to, with the capability refusal named rather than hidden. */
export type WorkerPoolTokenRedeemed =
  | { readonly result: "NotFound" }
  | { readonly result: "CapabilityNotPermitted" }
  | { readonly result: "Registered"; readonly value: WorkerPoolClientSecret };

/** What one mint asks for: what the machine will be allowed to claim, and for how long. */
export interface WorkerPoolTokenRequest {
  readonly capabilities: readonly string[];
  readonly lifetimeSecs: number;
}

/** How a token is drawn and digested, and what the clock says, all supplied. */
export interface WorkerPoolTokenMinting {
  readonly tokens: WorkerPoolRegistrationTokens;
  readonly draw: () => string;
  readonly digest: (token: string) => string;
  readonly nowMs: () => number;
}

/** The longest a registration token may stand, which bounds what an owner may ask for. */
export const workerPoolTokenLifetimeSecsMax = 3_600;

const millisecondsPerSecond = 1_000;

/**
 * Minting, exposed only through current `Administer` access to the project the
 * token names. It is the administrative permit rather than `Execute` because
 * what the token buys is the power to add a pool, which is a change to who may
 * run this project's work.
 */
export async function workerPoolTokenMint(
  access: ProjectAccess,
  minting: WorkerPoolTokenMinting,
  principal: Principal,
  partition: Partition,
  request: WorkerPoolTokenRequest,
): Promise<WorkerPoolTokenMinted> {
  if (
    !Number.isSafeInteger(request.lifetimeSecs) ||
    request.lifetimeSecs < 1 ||
    request.lifetimeSecs > workerPoolTokenLifetimeSecsMax
  )
    throw new RangeError(
      "worker pool registration token lifetime is past its bound",
    );
  if (
    (await access.authorize(principal, partition, "Administer")) === undefined
  )
    return { result: "NotFound" };
  const token = minting.draw();
  const expiresAtMs =
    minting.nowMs() + request.lifetimeSecs * millisecondsPerSecond;
  const written = await minting.tokens.mint(
    partition,
    minting.digest(token),
    request.capabilities,
    expiresAtMs,
  );
  switch (written) {
    case "Minted":
      return { result: "Minted", value: { token, expiresAtMs } };
    case "NotFound":
      return { result: "NotFound" };
    case "LimitReached":
      return { result: "LimitReached" };
    default:
      return assertNever(written);
  }
}

/** What one redemption offers: the token it holds, the name it takes and what it claims. */
export interface WorkerPoolRedemption {
  readonly token: string;
  readonly pool: string;
  readonly capabilities: readonly string[];
}

/**
 * Redemption, which authenticates on the token alone and authorizes on what the
 * token permits. A token that is unknown, spent or expired is one answer,
 * because telling the three apart tells a holder which of them it is.
 */
export async function workerPoolTokenRedeem(
  minting: WorkerPoolTokenMinting,
  ports: RegisterPoolPorts,
  issuer: string,
  offered: WorkerPoolRedemption,
): Promise<WorkerPoolTokenRedeemed> {
  const digest = minting.digest(offered.token);
  const terms = await minting.tokens.permitted(digest);
  if (terms === undefined) return { result: "NotFound" };
  if (
    !offered.capabilities.every((capability) =>
      terms.capabilities.includes(capability),
    )
  )
    return { result: "CapabilityNotPermitted" };
  const spent = await minting.tokens.consume(digest);
  if (spent === undefined) return { result: "NotFound" };
  let registered;
  try {
    registered = await workerPoolRegisteredAt(
      {
        partition: spent.partition,
        pool: offered.pool,
        capabilities: offered.capabilities,
        issuer,
      },
      ports,
    );
  } catch (failure) {
    await minting.tokens.restore(digest);
    throw failure;
  }
  return registered === undefined
    ? { result: "NotFound" }
    : { result: "Registered", value: registered };
}

/**
 * The two calls the boundary makes, composed once so that no route holds the
 * issuer's name or the ports registration is three writes at. A pool is
 * registered by redeeming a token and by an owner's own command, and this is
 * what the first of those runs.
 */
export interface WorkerPoolRegistrationService {
  mint(
    principal: Principal,
    partition: Partition,
    request: WorkerPoolTokenRequest,
  ): Promise<WorkerPoolTokenMinted>;
  redeem(offered: WorkerPoolRedemption): Promise<WorkerPoolTokenRedeemed>;
}

export function workerPoolRegistrationService(input: {
  readonly access: ProjectAccess;
  readonly minting: WorkerPoolTokenMinting;
  readonly ports: RegisterPoolPorts;
  readonly issuer: string;
}): WorkerPoolRegistrationService {
  return {
    mint: (principal, partition, request) =>
      workerPoolTokenMint(
        input.access,
        input.minting,
        principal,
        partition,
        request,
      ),
    redeem: (offered) =>
      workerPoolTokenRedeem(input.minting, input.ports, input.issuer, offered),
  };
}
