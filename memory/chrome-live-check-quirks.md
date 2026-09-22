---
name: chrome-live-check-quirks
description: "2026-09-06 live checks of the console through Claude-in-Chrome on Geoff's box: window maximized under Wayland so resize_window and window.open cannot make a phone width; screenshots came cropped until a documentElement zoom toggle"
metadata:
  type: reference
---

Checking a console release in Geoff's Chrome (rig at
https://chuggy-ui.vteng.io (the new console; chuggy.vteng.io is the old operations console and asks to sign in), Ory session already signed in):

- The window is maximized under Wayland: `resize_window` reports success
  but `innerWidth` stays 1562x863, `window.open` is blocked, xdotool sees no
  Chrome window. **A phone-width layout cannot be emulated from here** — ask
  Geoff or Dave to look on a phone, or rely on the suites.
- Screenshots came back cropped and stale (735x406) until a
  `document.documentElement.style.zoom` toggle (`"0.5"` then `""`) via the
  javascript tool; after that full 1456x821 captures worked.
- Switching the theme in the header switches Geoff's own preference — put
  it back to System when done.
- CSP check: `document.querySelectorAll("style").length` must be 0 after
  opening every card and pane.

**How to apply:** desktop dark/light and the details pane are checkable;
say plainly that the phone drawer was covered by suites only.
