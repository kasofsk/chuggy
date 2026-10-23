/**
 * Each page's glyph, drawn beside its name in the bar and the gear's menu and
 * alone in the bar on a phone, where the name is kept for a reader who does
 * not see the glyph. They are lucide's, as chuggernaut draws its own.
 */

import type { ReactNode } from "react";

import type { NavEntryId } from "../../core/shellNav.ts";

const navIconPaths: Readonly<Record<NavEntryId, ReactNode>> = {
  overview: (
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2" />
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  lead: (
    <>
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2" />
    </>
  ),
  catalog: (
    <>
      <rect width="8" height="18" x="3" y="3" rx="1" />
      <path d="M7 3v18M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z" />
    </>
  ),
  "ticket-new": <path d="M5 12h14M12 5v14" />,
  settings: (
    <path d="M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3" />
  ),
  repositories: (
    <>
      <path d="M18 19a5 5 0 0 1-5-5v8M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
      <circle cx="13" cy="12" r="2" />
      <circle cx="20" cy="19" r="2" />
    </>
  ),
  runners: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </>
  ),
};

export function NavIcon(props: { readonly id: NavEntryId }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {navIconPaths[props.id]}
    </svg>
  );
}
