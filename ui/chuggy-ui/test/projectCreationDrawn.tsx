/**
 * The project creation form drawn over an API and an access plane a case
 * scripts: the inventory, what the reader's own workspaces and their site
 * abilities each answer, and a creation, every one of which is kept. With it
 * are the hands a case fills the form with.
 *
 * A plane a case scripts nothing for answers neither read, which is the form
 * with its workspace as free text.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { AccessCallerTenant } from "../../../src/contract/accessPlane.ts";
import { SessionProvider } from "../app/browser/session.tsx";
import { answer, holderDouble, settled, turned } from "./screenHarness.tsx";

export interface ProjectCreationPosted {
  readonly key: string | undefined;
  readonly body: unknown;
}

interface Init {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

type Answered = () => Response | Promise<Response>;

/** What the access plane answers the form's reads with. */
export interface ProjectCreationAccess {
  readonly workspaces: Answered;
  readonly abilities: Answered;
}

const unanswered: Answered = () => answer({}, 404);

const accessUnanswered: ProjectCreationAccess = {
  workspaces: unanswered,
  abilities: unanswered,
};

export function administered(tenant: string): AccessCallerTenant {
  return { tenant, roles: ["Admin"], administer: true };
}

export function joined(tenant: string): AccessCallerTenant {
  return { tenant, roles: ["Member"], administer: false };
}

/** A plane listing these workspaces to a reader who may do nothing on the
 * site, or who may make a workspace there where `creator` says so. */
export function accessHolding(
  tenants: readonly AccessCallerTenant[],
  creator = false,
): ProjectCreationAccess {
  return {
    workspaces: () => answer({ tenants, truncated: false }),
    abilities: creator
      ? () =>
          answer({
            administer: false,
            createAccount: false,
            createTenant: true,
            manageAuthorities: false,
          })
      : unanswered,
  };
}

/** The API as one case scripts it, answering the inventory with `projects`
 * and keeping every creation it is sent. */
export function served(
  projects: readonly unknown[],
  created: () => Promise<Response>,
  access: ProjectCreationAccess = accessUnanswered,
): ProjectCreationPosted[] {
  const posted: ProjectCreationPosted[] = [];
  vi.stubGlobal("fetch", (url: string, init?: Init) => {
    if (init?.method === "POST" && url === "/api/v1/projects") {
      posted.push({
        key: init.headers?.["idempotency-key"],
        body: JSON.parse(init.body ?? "null"),
      });
      return created();
    }
    if (url === "/access/v1/workspaces")
      return Promise.resolve(access.workspaces());
    if (url === "/access/v1/site/abilities")
      return Promise.resolve(access.abilities());
    return Promise.resolve(answer({ projects }));
  });
  return posted;
}

/** The children mounted over a cache of their own, or over the one a case
 * hands in to mount them again over what an earlier mount read. */
export async function drawn(
  children: ReactNode,
  client = new QueryClient(),
): Promise<void> {
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>,
  );
  await settled();
}

export function typed(label: string, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value },
  });
}

export function submit(): HTMLElement {
  return screen.getByRole("button", { name: "Create project" });
}

export async function pressed(): Promise<void> {
  await turned(() => {
    fireEvent.click(submit());
  });
  await settled();
}

/** The line the last answer left beside the submit, none where none stands there. It is asked of the submit's own row, because the page's copy control is a status too. */
export function answerLine(): HTMLElement | null {
  const row = submit().parentElement;
  return row === null ? null : within(row).queryByRole("status");
}

/** The line a box is described by, which is where the rule stands. */
export function ruleUnder(label: string): HTMLElement {
  const box = screen.getByRole("textbox", { name: label });
  const line = document.getElementById(
    box.getAttribute("aria-describedby") ?? "",
  );
  if (line === null) throw new Error(`nothing describes ${label}`);
  return line;
}

/** The workspace choice's trigger, whose name ends in the entry it stands on. */
export function workspaceChoice(): HTMLElement {
  return screen.getByRole("button", { name: /^Workspace / });
}

/** What a reader sees captioning the workspace field, which the label the
 * choice's trigger carries for a screen reader is not. */
export function workspaceCaptions(): readonly HTMLElement[] {
  return screen
    .queryAllByText("Workspace")
    .filter((caption) => !caption.classList.contains("visually-hidden"));
}

/** The entries the choice lists, read off its opened menu, which is closed
 * again before they are handed back. */
export async function workspaceEntries(): Promise<readonly string[]> {
  fireEvent.keyDown(workspaceChoice(), { key: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  const entries = within(menu)
    .getAllByRole("menuitemradio")
    .map((entry) => entry.textContent);
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
  return entries;
}

export async function workspaceChosen(entry: string): Promise<void> {
  fireEvent.keyDown(workspaceChoice(), { key: "ArrowDown" });
  fireEvent.click(
    within(await screen.findByRole("menu")).getByRole("menuitemradio", {
      name: entry,
    }),
  );
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
}
