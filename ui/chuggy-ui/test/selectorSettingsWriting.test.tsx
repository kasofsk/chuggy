/**
 * A settings write outlives the page that pressed it: a refusal landing once
 * the page is gone is the shell's toast rather than a line nobody draws.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen } from "@testing-library/react";
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
import { consoleQueryClient } from "../app/core/consoleWrite.ts";
import { projectPartition } from "./projectFixture.ts";
import { selectorSettingsBody } from "./selectorSettingsFixture.ts";
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
import { renderCopied } from "./copied.tsx";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = selectorSettingsBody() as SelectorProjectSettingsResponse;

/** The page's door, a press through it, and the line it draws of its own
 * writer's write. */
function Writer(): ReactNode {
  const held = useSelectorSettingsDraft(settings);
  const writing = useSelectorSettingsWriting<"writer">(projectPartition, held);
  const shown = selectorSettingsShown(writing, "writer");
  return (
    <section aria-label="Settings">
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

test("a refusal of a write, landing once its page is gone, is a toast", async () => {
  const writing = heldAnswer();
  const scripted = scriptedFetch((request) =>
    request.method === "PUT" ? writing.answered : answer(settings),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const client = consoleQueryClient();
  const tree = (drawn: boolean): ReactNode => (
    <ScreenHarness
      partition={projectPartition}
      client={client}
      transport={openedStream().ports.fetch}
    >
      {drawn ? <Writer /> : null}
      <ConsoleWriteToasts />
    </ScreenHarness>
  );
  const view: RenderResult = renderCopied(tree(true));
  await settled();
  await turned(() => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await turned(() => {
    view.rerender(tree(false));
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
