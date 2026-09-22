---
name: radix-when-idiomatic
description: "Geoff 2026-09-06: console rule — use Radix UI when it is idiomatic; vendor components (assistant-ui) are adopted; Tailwind optional, not a prerequisite"
metadata:
  type: feedback
---

Geoff, 2026-09-06, after the Radix batch (chuggy #593) shipped: "Let's make a
rule to use radix UI when it's idiomatic. And I think what I understand now
is that we are ready to adopt the vendor components. Tailwind is optional."

**Why:** the Radix adoption was the gate before wiring assistant-ui; with the
primitives proven CSP-clean the console is ready for vendor components, and
Tailwind was only ever a question of whether it helps, not a step in the
order.

**How to apply:** in `ui/chuggy-ui/`, reach for a Radix primitive wherever
the control is one Radix models (menu, tooltip, disclosure, toggle group,
toolbar, dialog non-modal, popover non-modal); keep native elements where
Radix is not idiomatic or is CSP-refused (Select). Next work is the
assistant-ui wiring without waiting on a Tailwind decision; the shell's
toolbar of buttons is a candidate for Radix Toolbar when touched.
