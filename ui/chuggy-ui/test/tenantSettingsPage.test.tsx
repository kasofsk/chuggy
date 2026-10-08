/**
 * The tenant settings index, mounted: the tenant's settings groups, each one
 * line linking to its own page.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { TenantSettingsPage } from "../app/browser/TenantSettingsPage.tsx";
import { answer, drawnStrict } from "./screenHarness.tsx";

const tenant = "acme";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
  useNavigate: () => (to: unknown) => Promise.resolve(to),
  useParams: () => ({ tenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function drawTenantSettings(): Promise<void> {
  await drawnStrict(<TenantSettingsPage />, () => answer({ projects: [] }));
}

test("the index names the Accounts group and links to its own page", async () => {
  await drawTenantSettings();
  expect(
    screen
      .getByRole<HTMLAnchorElement>("link", { name: "Accounts" })
      .getAttribute("href"),
  ).toBe(`/tenants/${tenant}/settings/accounts`);
});

test("the index names the People group and links to its own page", async () => {
  await drawTenantSettings();
  expect(
    screen
      .getByRole<HTMLAnchorElement>("link", { name: "People" })
      .getAttribute("href"),
  ).toBe(`/tenants/${tenant}/settings/people`);
});
