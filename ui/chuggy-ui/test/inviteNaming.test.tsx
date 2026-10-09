/**
 * A link that makes a workspace, on the page it is opened at: the plane's
 * request for a name draws the form on the same card and keeps the cookie,
 * the name is sent by a press of `Create` and by no mount, and each answer
 * to it is the field's to say, the card's, or the reader sent on.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  accessTenantTakenCode,
  accessWorkspaceLinkNameWantedCode,
} from "../../../src/contract/accessPlane.ts";
import { inviteCookieCleared } from "../app/core/invitePage.ts";
import { projectNameRule } from "../app/core/projectCreation.ts";
import { inviteConfiguration } from "./inviteDouble.ts";
import {
  inviteButtonsDrawn,
  inviteOpened,
  inviteRedemptionsSent,
} from "./invitePageDrawn.tsx";
import type { InviteOpened } from "./invitePageDrawn.tsx";
import {
  answer,
  heldAnswer,
  press,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function refused(status: number, code: string): Response {
  return answer({ error: { code, message: "refused" } }, status);
}

const made = { tenant: "northwind", role: "Admin", projects: [] };

const first = { token: "crossed" };

const named = { token: "crossed", workspace: "northwind" };

/** A workspace link opened by a reader whose token crossed a sign-in: the send
 * without a name asked for one, and a send with one answered by the case. */
function linked(
  answered: () => Response | Promise<Response> = () => answer(made),
): Promise<InviteOpened> {
  return inviteOpened(
    "SignedIn",
    { cookies: "chuggy_invite=crossed" },
    {
      configuration: inviteConfiguration("example.com"),
      answered: (request: SentRequest) =>
        JSON.stringify(request.body) === JSON.stringify(first)
          ? refused(409, accessWorkspaceLinkNameWantedCode)
          : answered(),
    },
  );
}

function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", {
    name: "Workspace name",
  });
}

function create(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Create" });
}

/** What stands under the field, which is its fault and nothing else. */
function fault(): string {
  return (
    document.getElementById(field().getAttribute("aria-describedby") ?? "")
      ?.textContent ?? ""
  );
}

async function typed(name: string): Promise<void> {
  fireEvent.change(field(), { target: { value: name } });
  await turned();
}

/** Enter in the field, which a browser hands the form as its submission, and
 * whether the page let the browser go on to send the form itself. */
async function entered(): Promise<boolean> {
  const form = field().form;
  if (form === null) throw new Error("the field stands in no form");
  let sent = true;
  await turned(() => {
    sent = fireEvent.submit(form);
  });
  await settled();
  return sent;
}

async function created(
  answered?: () => Response | Promise<Response>,
): Promise<InviteOpened> {
  const opened = await linked(answered);
  await typed("northwind");
  await press("Create");
  return opened;
}

test("a link that asks for its workspace's name draws the form on the same card, and keeps the cookie", async () => {
  const { browser, sent } = await linked();
  expect(screen.getByRole("heading", { name: "chuggy" })).toBeTruthy();
  expect(screen.getByText("New workspace")).toBeTruthy();
  expect(field().value).toBe("");
  expect(fault()).toBe("");
  expect(inviteButtonsDrawn()).toStrictEqual(["Create"]);
  expect(create().disabled).toBe(true);
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first]);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  styleless();
});

test("the send without a name is made once under a double mount and a remount, and no mount sends a name", async () => {
  const { sent, remount } = await linked();
  await typed("northwind");
  await remount();
  expect(field().value).toBe("");
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first]);
});

test("the field is judged as the New workspace dialog judges its name, and Create is held until the name may be sent", async () => {
  await linked();
  await typed("North Wind");
  expect(fault()).toBe(projectNameRule);
  expect(field().getAttribute("aria-invalid")).toBe("true");
  expect(create().disabled).toBe(true);
  await typed("projects");
  expect(fault()).toBe("Reserved");
  expect(create().disabled).toBe(true);
  await typed("northwind");
  expect(fault()).toBe("");
  expect(field().getAttribute("aria-invalid")).toBe("false");
  expect(create().disabled).toBe(false);
});

test("Create sends the token with the name, once a press", async () => {
  const { sent } = await created(() => refused(409, accessTenantTakenCode));
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named]);
  await press("Create");
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named, named]);
});

test("Create is the button the field's form is submitted by, so Enter in the field presses it", async () => {
  const { sent } = await linked(() => refused(409, accessTenantTakenCode));
  await typed("northwind");
  expect(create().type).toBe("submit");
  expect(create().form).toBe(field().form);
  expect(await entered()).toBe(false);
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named]);
});

test("Enter on a name that may not be sent sends nothing, and the browser is not left to send the form", async () => {
  const { sent } = await linked();
  expect(await entered()).toBe(false);
  await typed("North Wind");
  expect(await entered()).toBe(false);
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first]);
});

test("a name unanswered, the card says Creating… and the field and Create take nothing", async () => {
  const held = heldAnswer();
  const { browser, sent } = await created(() => held.answered);
  expect(screen.getByText("Creating…")).toBeTruthy();
  expect(screen.queryByText("New workspace")).toBeNull();
  expect(field().disabled).toBe(true);
  expect(field().value).toBe("northwind");
  expect(create().disabled).toBe(true);
  await entered();
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named]);
  expect(browser.written).toStrictEqual([]);
  await turned(() => {
    held.release(answer(made));
  });
  await settled();
  expect(browser.left).toStrictEqual(["/projects/new?workspace=northwind"]);
  styleless();
});

test("a workspace made clears the cookie and sends its reader, in this entry's place, to where its first project is made", async () => {
  const { browser, sent, remount } = await created();
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual(["/projects/new?workspace=northwind"]);
  expect(screen.getByText("Creating…")).toBeTruthy();
  expect(create().disabled).toBe(true);
  await remount();
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named]);
  expect(browser.left).toStrictEqual(["/projects/new?workspace=northwind"]);
});

test("a name something holds says Name taken under the field, the name still there and the link still open", async () => {
  const { browser } = await created(() => refused(409, accessTenantTakenCode));
  expect(fault()).toBe("Name taken");
  expect(field().value).toBe("northwind");
  expect(field().disabled).toBe(false);
  expect(screen.getByText("New workspace")).toBeTruthy();
  expect(inviteButtonsDrawn()).toStrictEqual(["Create"]);
  expect(create().disabled).toBe(false);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  await typed("northwind-2");
  expect(fault()).toBe("");
  styleless();
});

test("a name the plane will not read says Name not valid under the field, the name still there", async () => {
  const { browser } = await created(() => refused(400, "InvalidRequest"));
  expect(fault()).toBe("Name not valid");
  expect(field().value).toBe("northwind");
  expect(create().disabled).toBe(false);
  expect(browser.written).toStrictEqual([]);
});

test("a link the plane no longer knows when its name is sent is drawn Link not valid, its cookie ended", async () => {
  const { browser } = await created(() => answer({}, 404));
  expect(screen.getByText("Link not valid")).toBeTruthy();
  expect(inviteButtonsDrawn()).toStrictEqual(["Open chuggy"]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  await press("Open chuggy");
  expect(browser.left).toStrictEqual(["/"]);
});

test("a name that failed keeps the cookie and says the fault, and Retry sends the same name again and no send without one", async () => {
  let fails = true;
  const { browser, sent } = await created(() =>
    fails
      ? answer({ error: { code: "InternalError", message: "no" } }, 500)
      : answer(made),
  );
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(inviteButtonsDrawn()).toStrictEqual(["Retry"]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  await press("Retry");
  expect(inviteRedemptionsSent(sent)).toStrictEqual([first, named, named]);
  expect(screen.getByText("Failed")).toBeTruthy();
  fails = false;
  await press("Retry");
  expect(inviteRedemptionsSent(sent)).toStrictEqual([
    first,
    named,
    named,
    named,
  ]);
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual(["/projects/new?workspace=northwind"]);
});
