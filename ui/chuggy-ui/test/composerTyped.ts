/**
 * Typing into a conversation's box, with the caret left where a member's
 * would be: a list the box opens reads back from the caret, so a box whose
 * selection stayed at zero opens nothing.
 */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

export async function composerTyped(
  text: string,
): Promise<HTMLTextAreaElement> {
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
  await waitFor(() => {
    expect(box.value).toBe(text);
  });
  return box;
}
