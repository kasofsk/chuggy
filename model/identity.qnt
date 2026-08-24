/// Durable authority identities outside the local ticket machine.
module chuggy_identity {
  type InstallationId = str
  type TicketRef = { installation: InstallationId, ticket: int }
}
