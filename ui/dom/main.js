/**
 * Boot: read the runtime configuration, settle the session, then hand the page
 * to the console.
 *
 * Every way this can fail ends in a drawn state naming the step that failed —
 * an unconfigured artifact, an unreachable issuer and a declined sign-in are
 * three different sentences, and none of them is a blank page.
 */

import { createConsole } from "./console.js";
import { createSession } from "./session.js";
import { send } from "./transport.js";
import { draw } from "./view.js";

const nowMs = () => Date.now();
const session = createSession(nowMs);

const page = {
  host: document.getElementById("console"),
  select: document.getElementById("project"),
  session: document.getElementById("session"),
  refresh: document.getElementById("refresh"),
  boot: { step: "Loading", reason: "Reading the console configuration…" },
  label: undefined,
  controller: undefined,
  nowMs: nowMs(),
  onSignIn: () => {
    settle(session.beginSignIn());
  },
  onSignOut: () => {
    session.signOut();
    page.controller?.pause();
    page.controller = undefined;
    page.boot = { step: "SignedOut", reason: "Signed out of this tab." };
    changed();
  },
};

function changed() {
  page.nowMs = nowMs();
  draw(page);
}

/** A rejected step becomes a drawn state rather than an unhandled rejection. */
function settle(promise) {
  promise.catch(() => {
    page.boot = {
      step: "Faulted",
      reason:
        "The console hit an error it could not place. Reload to try again.",
    };
    changed();
  });
}

page.select.addEventListener("change", () => {
  const chosen = page.select.value;
  if (chosen.length > 0) page.controller?.select(JSON.parse(chosen));
});

async function signedIn() {
  page.boot = { step: "SignedIn", reason: "" };
  page.label = session.label();
  page.controller = createConsole({ session, nowMs, send, onChanged: changed });
  changed();
  await page.controller.loadProjects();
}

async function callback() {
  const outcome = await session.completeSignIn(location.search);
  history.replaceState(null, "", "/");
  if (outcome.result === "Denied")
    page.boot = {
      step: "SignedOut",
      reason: `Sign-in did not complete: ${outcome.reason}`,
    };
}

async function boot() {
  changed();
  try {
    await session.load();
  } catch {
    page.boot = {
      step: "Faulted",
      reason:
        "This deployment has no readable /config.json, or its issuer did not answer.",
    };
    changed();
    return;
  }
  if (location.pathname === session.redirectPath()) await callback();
  if (session.signedIn()) {
    await signedIn();
    return;
  }
  if (page.boot.step !== "SignedOut")
    page.boot = {
      step: "SignedOut",
      reason: "Sign in to read this installation.",
    };
  changed();
}

settle(boot());
