## The product's own nouns. A message names one as a term and never spells it,
## so a vernacular that renames it renames it everywhere.

-tickets = { $case ->
    [upper] Tickets
   *[lower] tickets
}

-epics = { $case ->
    [upper] Epics
   *[lower] epics
}

-project = { $case ->
    [upper] Project
   *[lower] project
}

-projects = { $case ->
    [upper] Projects
   *[lower] projects
}

-repositories = { $case ->
    [upper] Repositories
   *[lower] repositories
}

-runners = { $case ->
    [upper] Runners
   *[lower] runners
}

-lead = { $case ->
    [upper] Lead
   *[lower] lead
}

-catalog = { $case ->
    [upper] Catalog
   *[lower] catalog
}

-inbox = { $case ->
    [upper] Inbox
   *[lower] inbox
}

-site = site
