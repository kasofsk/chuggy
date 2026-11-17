/**
 * A word's detail: in the document after the word with no hover, and one of
 * more than one line behind a Details press that shows it; and a
 * conversation marker's failure code drawn so.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  ConversationSystemLine,
  conversationMarkerDetail,
  conversationMarkerWords,
} from "../app/browser/conversation/ConversationLines.tsx";
import { WordDetail } from "../app/browser/ui/WordDetail.tsx";
import { renderCopied } from "./copied.tsx";

afterEach(cleanup);

test("a detail of one line follows its word in the quieter ink, with no tooltip", () => {
  const view = renderCopied(
    <p>
      <WordDetail word="Refused" detail="Throttled" />
    </p>,
  );
  expect(view.container.textContent).toBe("Refused · Throttled");
  expect(screen.getByText(/Throttled/u).className).toBe("word-detail");
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a detail of more than one line is behind Details, which shows it", () => {
  const said = '[\n  "too_big"\n]';
  const view = renderCopied(
    <p>
      <WordDetail word="Unreadable" detail={said} />
    </p>,
  );
  const more = screen.getByRole("button", { name: "Details" });
  const body = view.container.querySelector(".word-detail-more");
  expect(body?.textContent).toBe(said);
  expect(body?.hasAttribute("hidden")).toBe(true);
  expect(more.getAttribute("aria-controls")).toBe(body?.id);
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(body?.hasAttribute("hidden")).toBe(false);
  expect(more.getAttribute("aria-expanded")).toBe("true");
});

test("no detail draws the word alone", () => {
  const view = renderCopied(
    <p>
      <WordDetail word="Refused" detail={undefined} />
    </p>,
  );
  expect(view.container.textContent).toBe("Refused");
});

test("a conversation's marker line says its failure's code after its words", () => {
  const view = renderCopied(
    <ConversationSystemLine
      words={conversationMarkerWords({
        marker: "Failure",
        failure: { outcome: "Fault", code: "InternalError", status: 500 },
      })}
      detail={conversationMarkerDetail({
        marker: "Failure",
        failure: { outcome: "Fault", code: "InternalError", status: 500 },
      })}
    />,
  );
  expect(view.container.textContent).toMatch(/ · InternalError$/u);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
