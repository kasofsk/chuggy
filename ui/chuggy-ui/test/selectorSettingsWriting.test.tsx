/**
 * The selector settings are written from two pages, and each page's write is
 * its own: a page drawn while the other's write is out does not take it up,
 * so a refusal of it is the shell's toast rather than a line nobody draws.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { SelectorProjectSettingsResponse } from "../../../src/contract/responses.ts";
import { ConsoleWriteToasts } from "../app/browser/consoleWrite.tsx";
import {
  selectorSettingsShown,
  useSelectorSettingsDraft,
  useSelectorSettingsWriting,
} from "../app/browser/selectorSettingsWriting.ts";
import type { SelectorSettingsPage } from "../app/browser/selectorSettingsWriting.ts";
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { leadPartition, leadSelectorSettingsBody } from "./leadFixture.ts";
import {
  answer,
  heldAnswer,
  openedStream,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = leadSelectorSettingsBody() as SelectorProjectSettingsResponse;

/** One page's door, a press through it, and the line it draws of its own
 * writer's write. */
function Writer(props: { readonly page: SelectorSettingsPage }): ReactNode {
  const held = useSelectorSettingsDraft(settings);
  const writing = useSelectorSettingsWriting<"writer">(
    props.page,
    leadPartition,
    held,
  );
  const shown = selectorSettingsShown(writing, "writer");
  return (
    <section aria-label={props.page}>
      <button
        type="button"
        onClick={() => {
          writing.write("writer", {}, () => undefined);
        }}
      >
        Save
      </button>
      {shown?.isPending === true ? <p role="status">Writing</p> : null}
      {shown === undefined || shown.error === null ? null : (
        <p role="status">{shown.error.message}</p>
      )}
    </section>
  );
}

function toastLines(): readonly (string | null)[] {
  return [...document.querySelectorAll(".toast-line")].map(
    (line) => line.textContent,
  );
}

test("a refusal of one page's write, landing while the other page is drawn, is a toast", async () => {
  const writing = heldAnswer();
  const scripted = scriptedFetch((request) =>
    request.method === "PUT" ? writing.answered : answer(settings),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const client = consoleQueryClient();
  const tree = (page: SelectorSettingsPage): ReactNode => (
    <ScreenHarness
      partition={leadPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      <Writer key={page} page={page} />
      <ConsoleWriteToasts />
    </ScreenHarness>
  );
  const view: RenderResult = render(tree("Lead"));
  await settled();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await turned(() => {
    view.rerender(tree("Settings"));
  });
  await settled();
  expect(screen.queryByRole("status")).toBeNull();

  await turned(() => {
    writing.release(answer({ error: { code: "Fault" } }, 500));
  });
  await settled();

  expect(toastLines()).toHaveLength(1);
  expect(scripted.sent.filter((sent) => sent.method === "PUT")).toHaveLength(1);
});
