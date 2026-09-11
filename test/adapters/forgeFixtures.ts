/**
 * The recording forge two adapter suites compose against, and what one request
 * to it is kept as.
 *
 * IT IS SHARED BECAUSE BOTH ADAPTERS REFUSE A REDIRECT. A forge that followed
 * one would prove nothing about either, so the recorder treats a redirect the
 * way the platform does — a request that refused one is rejected — and one
 * recorder is what keeps that behaviour the same in both suites.
 */

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
    calls.push({
      url: fixtureUrlOf(input),
      method: String(request.method),
      headers: { ...(request.headers as Record<string, string>) },
      body: typeof request.body === "string" ? request.body : undefined,
      redirect: request.redirect,
    });
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
