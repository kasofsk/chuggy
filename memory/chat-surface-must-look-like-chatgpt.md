---
name: chat-surface-must-look-like-chatgpt
description: "Geoff 2026-09-06 on the released assistant-ui surface: it must feel exactly like ChatGPT/Claude.ai — recognisably a chat box; rejected the full-width work-disclosure bar, the button colouring, and a page with no visible conversation boundary; design spike by interview follows"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 75a96485-da08-4513-a3dd-8775b9b41fb0
  modified: 2026-09-06T23:23:34.145Z
---

Geoff, 2026-09-06, after release 32 put the assistant-ui conversation
surface live: "It looks pretty decent" but
(1) the button colouring is wrong, (2) the "Thought · Tools · Notes"
disclosure "spans the whole screen, and it's just hard to read" and is not
what Anthropic or OpenAI do — "probably a little card in there", (3) it is
"not clear where the conversation starts and ends" — the page reads as one
panel rather than a chat, and (4) "although it's arbitrary, I do want this
to feel basically exactly like ChatGPT or Claude ... they should look at it
and see and feel it's obviously a chat box that they're used to."

**Why:** the surface is for members who already use those products; the
value of a vendor chat component is that nothing has to be learned. A
console-panel treatment (full-width rows, house pills everywhere) throws
that away.

**How to apply:** treat Claude.ai / ChatGPT as the reference rendering, not
an inspiration: bounded conversation column, the reader's messages as
bubbles, the assistant's flush text, small inline "thought/tool" chips or
cards inside the exchange, composer docked at the bottom. Run a design
spike by freeform one-at-a-time interview before building; relate to
[[chuggy-ui-copy-standard]] and [[chuggy-ui-copy-standard]] for the house
voice inside that shape.
