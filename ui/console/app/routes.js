export const ticketNumberMax = 2_147_483_647;

/** @param {string} pathname */
export function routeParsed(pathname) {
  if (pathname === "/" || pathname === "/tickets") return { page: "Home" };
  if (pathname === "/operations") return { page: "Operations" };
  if (pathname === "/configurations") return { page: "Configurations" };
  if (pathname === "/tickets/new") return { page: "NewTicket" };
  const match = /^\/tickets\/(\d+)$/.exec(pathname);
  if (match !== null) {
    const ticket = Number(match[1]);
    if (Number.isSafeInteger(ticket) && ticket > 0 && ticket <= ticketNumberMax)
      return { page: "Ticket", ticket };
  }
  return { page: "Home" };
}

/** @param {{ page: string, ticket?: number }} route */
export function routePath(route) {
  if (route.page === "Operations") return "/operations";
  if (route.page === "Configurations") return "/configurations";
  if (route.page === "NewTicket") return "/tickets/new";
  if (route.page === "Ticket" && route.ticket !== undefined)
    return `/tickets/${String(route.ticket)}`;
  return "/";
}
