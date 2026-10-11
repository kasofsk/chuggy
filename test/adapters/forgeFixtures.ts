/**
 * The recording forge two adapter suites compose against, and what one request
 * to it is kept as.
 *
 * IT IS SHARED BECAUSE BOTH ADAPTERS REFUSE A REDIRECT. A forge that followed
 * one would prove nothing about either, so the recorder treats a redirect the
 * way the platform does — a request that refused one is rejected — and one
 * recorder is what keeps that behaviour the same in both suites.
 *
 * A MINTED TOKEN IS THE FORGE'S OWN SHAPE HERE. A suite standing a short
 * sentinel in for one proves nothing about the brand a token passes through,
 * so the shape is written once and every suite needing a real one reads it.
 *
 * THE GRANTING FORGE IS THE ONE THAT REMEMBERS. The recorder answers what a
 * case scripted in the order it scripted it, which cannot show a listing going
 * stale; the granting forge mints and lists for itself, so what a listing
 * shows there turns on which token it was read under.
 */

/**
 * A minted token as the forge issues one now: the prefix, then a structured
 * tail whose length is past what a stored identity's bound admits.
 */
export const fixtureForgeShapedToken = `ghs_${[
  "A1b2C3d4",
  "E5f6G7h8",
  "I9j0K1l2",
]
  .map((segment) => segment.repeat(16))
  .join(".")}`;

/** One recorded forge request, kept as plain strings so a case can assert the whole of it. */
export interface ForgeCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly redirect: RequestInit["redirect"];
}

export interface ForgeRecorder {
  readonly requestFetch: typeof fetch;
  readonly calls: ForgeCall[];
}

/** Whether one answer is a redirect, which the platform treats as neither an answer nor a refusal. */
function fixtureRedirects(answer: Response): boolean {
  return answer.status >= 300 && answer.status < 400;
}

/** The address a request was made to, whichever of the three shapes it arrived in. */
export function fixtureUrlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** One request as the recorder keeps it. */
function fixtureCallOf(
  input: string | URL | Request,
  request: RequestInit,
): ForgeCall {
  return {
    url: fixtureUrlOf(input),
    method: String(request.method),
    headers: { ...(request.headers as Record<string, string>) },
    body: typeof request.body === "string" ? request.body : undefined,
    redirect: request.redirect,
  };
}

/**
 * The forge a suite composes an adapter with, answering the given answers in
 * order and treating a redirect the way the platform does: a request that
 * refused one is rejected, and one that did not is made a second time.
 */
export function fixtureForge(
  answers: readonly (Response | Error)[],
): ForgeRecorder {
  const calls: ForgeCall[] = [];
  let served = 0;
  const serve = (
    input: string | URL | Request,
    request: RequestInit,
  ): Promise<Response> => {
    calls.push(fixtureCallOf(input, request));
    const answer = answers[served];
    served += 1;
    if (answer === undefined)
      return Promise.reject(new Error("the fixture forge ran out"));
    if (answer instanceof Error) return Promise.reject(answer);
    if (!fixtureRedirects(answer)) return Promise.resolve(answer);
    if (request.redirect === "error")
      return Promise.reject(new TypeError("the fixture forge redirected"));
    return serve(answer.headers.get("location") ?? "", {
      headers: request.headers ?? {},
      method: "GET",
    });
  };
  const requestFetch: typeof fetch = (input, init) => serve(input, init ?? {});
  return { requestFetch, calls };
}

/** A forge whose one installation a case grants repositories to as it goes. */
export interface GrantingForge extends ForgeRecorder {
  readonly grant: (repository: string) => void;
}

/** When every token the granting forge mints lapses, which no case reaches. */
const fixtureGrantingExpiry = "2099-09-10T12:00:00Z";

/** The scheme a minted token is presented under. */
const fixtureBearerScheme = "Bearer ";

/** One granted repository as the forge lists it. */
function fixtureGrantedRow(account: string, repository: string): unknown {
  return {
    name: repository,
    full_name: `${account}/${repository}`,
    clone_url: `https://github.com/${account}/${repository}.git`,
    default_branch: "main",
    private: true,
  };
}

/**
 * The forge of one installation on `account`, where a token sees what was
 * granted when it was minted and nothing granted since: the strictest way a
 * forge can read one, so a listing that shows a grant here shows it however a
 * real one reads. A bearer this forge did not mint is refused.
 */
export function fixtureGrantingForge(account: string): GrantingForge {
  const calls: ForgeCall[] = [];
  const granted: string[] = [];
  const seenUnder = new Map<string, readonly string[]>();
  const minted = (): Response => {
    const token = `ghs-granting-${String(seenUnder.size)}`;
    seenUnder.set(token, [...granted]);
    return Response.json(
      { token, expires_at: fixtureGrantingExpiry },
      { status: 201 },
    );
  };
  const listed = (url: URL, call: ForgeCall): Response => {
    const presented = call.headers["authorization"] ?? "";
    const seen = seenUnder.get(presented.slice(fixtureBearerScheme.length));
    if (!presented.startsWith(fixtureBearerScheme) || seen === undefined)
      return new Response("{}", { status: 401 });
    const pageSize = Number(url.searchParams.get("per_page"));
    const from = (Number(url.searchParams.get("page")) - 1) * pageSize;
    return Response.json({
      total_count: seen.length,
      repositories: seen
        .slice(from, from + pageSize)
        .map((repository) => fixtureGrantedRow(account, repository)),
    });
  };
  const requestFetch: typeof fetch = (input, init) => {
    const call = fixtureCallOf(input, init ?? {});
    calls.push(call);
    const url = new URL(call.url);
    return Promise.resolve(
      url.pathname.endsWith("/access_tokens") ? minted() : listed(url, call),
    );
  };
  return {
    requestFetch,
    calls,
    grant: (repository) => {
      granted.push(repository);
    },
  };
}
