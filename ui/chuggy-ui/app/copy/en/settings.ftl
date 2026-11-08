## The settings pages.

settings-nav = Settings
settings-nav-project = { -project(case: "upper") }
settings-nav-lead = { -lead(case: "upper") }
settings-nav-placement = { -placement(case: "upper") }
settings-nav-permissions = Permissions
settings-nav-workspace = { -workspace(case: "upper") }
settings-nav-people = People
settings-nav-accounts = { -github } accounts
settings-nav-personal-runners = { -personal-runner(case: "upper", form: "plural") }
settings-nav-usage = Usage
settings-nav-site = { -site(case: "upper") }
settings-nav-workspaces = { -workspace(case: "upper", form: "plural") }

settings-cancel = Cancel
settings-done = Done
settings-edit = Edit
settings-remove = Remove
settings-none = None
settings-creating = Creating…

## The roles, and what else a person holds in a workspace.

settings-role-admin = { -role-admin(case: "upper") }
settings-role-member = { -role-member(case: "upper") }
settings-role-developer = { -role-developer(case: "upper") }
settings-role-dispatcher = { -role-dispatcher(case: "upper") }
settings-role-viewer = { -role-viewer(case: "upper") }
settings-role-hosted-runs = { -hosted-runs(case: "upper") }
settings-role-personal-runners = { -personal-runner(case: "upper", form: "plural") }
settings-role-unscoped-chat = Unscoped { -thread }

## Why the access plane refused, and any other answer but a success.

settings-access-invites-unconfigured = { -invite(case: "upper", form: "plural") } not configured
settings-access-project-unknown = { -project(case: "upper") } not in this { -workspace }
settings-access-account-not-permitted = Account creation not permitted
settings-access-github-unknown = No such { -github } user
settings-access-github-not-user = Not a person's { -github } account
settings-access-email-held = Email held by another account · use another address
settings-access-email-refused = Email refused
settings-access-github-unavailable = { -github } unavailable
settings-access-directory-raced = Directory changed · try again
settings-access-directory-unavailable = Directory unavailable
settings-access-link-limit = Link limit reached
settings-access-last-admin = Only { -role-admin } · grant another first
settings-access-not-permitted = Change not permitted
settings-access-holder-not-admitted = Holder not admitted
# The code the plane answered with, which this console does not know.
settings-access-unknown = Unknown refusal ({ $code })
settings-access-signed-out = Not signed in
settings-access-absent = Not available
settings-access-failed = Failed
settings-access-unreachable = Unreachable
settings-access-unreadable = Unreadable

## A workspace's people.

settings-people-title = People
settings-people-withheld = { -workspace(case: "upper", form: "a") } { -role-admin } manages people
settings-people-truncated = List cut short
settings-people-count = { $count ->
    [one] { $count } person
   *[other] { $count } people
}
settings-people-other-issuers = { $count } more from another sign-in
settings-people-person = Person
settings-people-identities = Other identities
settings-people-identity = Identity
settings-people-workspace = { -workspace(case: "upper") }
settings-people-projects = { -project(case: "upper", form: "plural") }
settings-people-every-project = All { -project(form: "plural") }
settings-people-edit-named = Edit { $name }
settings-people-grid-box = { $project } { $role }

settings-person-hosted-runs-question = Remove { -hosted-runs }
settings-person-hosted-runs-line = { -run(case: "upper", form: "plural") } this identity starts will stop.
settings-person-admin-question = Remove your { -role-admin } role
settings-person-admin-line = You will no longer manage this { -workspace }.

## Inviting a person, or making an invite link.

# spells -invite: to invite is a verb here
settings-invitation-mode = Invite by
settings-invitation-mode-person = Person
settings-invitation-mode-link = Link
settings-invitation-email = Email
settings-invitation-email-fault = Not an email
settings-invitation-github = { -github } username
settings-invitation-github-fault = Not a { -github } username
settings-invitation-accounts = Existing accounts only
settings-invitation-projects-most = { $count ->
    [one] At most { $count } { -project }
   *[other] At most { $count } { -project(form: "plural") }
}
settings-invitation-projects-once = Each { -project } once
settings-invitation-role = { -workspace(case: "upper") } role
# spells -invite: to invite is a verb here
settings-invitation-send = Invite
settings-invitation-sending = Inviting…
# spells -invite: to invite is a verb here
settings-invitation-title = Invite to { $tenant }

settings-invite-link-create = Create link
settings-invite-link-made = { -invite(case: "upper") } link
settings-invite-link-copy = Copy link
settings-invite-link-shown-once = Shown once
settings-invite-links = { -invite(case: "upper") } links
settings-invite-links-access = Access
settings-invite-links-status = Status
settings-invite-links-used-by = Used by
settings-invite-links-made-by = Made by
settings-invite-links-expires = Expires
# spells -revoke: a link is revoked, not a ticket
settings-invite-links-revoke = Revoke
# spells -revoke: a link is revoked, not a ticket
settings-invite-links-revoke-question = Revoke link
settings-invite-links-revoke-line = This link will stop working.
settings-invite-link-open = Open
settings-invite-link-used = Used
# spells -revoke: a link is revoked, not a ticket
settings-invite-link-revoked = Revoked
settings-invite-link-expired = Expired

## The page an invite link is opened at.

settings-invite-brand = { -brand-name }
settings-invite-needed = { -invite(case: "upper") } needed
settings-invite-invited = Invited
settings-invite-joining = Joining…
settings-invite-not-valid = Link not valid
settings-invite-sign-in = Sign in
settings-invite-open = Open { -brand-name }
settings-invite-retry = Retry
settings-invite-naming = New { -workspace }
settings-invite-workspace-name = { -workspace(case: "upper") } name
settings-invite-workspace-about = Your { -workspace }. { -project(case: "upper", form: "plural") } go inside.
settings-invite-create = Create
settings-invite-name-not-valid = Name not valid

## Adding a holder to a permission, and removing one.

settings-permissions-title = Permissions
settings-permissions-project = { -project(case: "upper") } permissions
settings-permissions-workspace = { -workspace(case: "upper") } permissions
settings-permissions-site = { -site(case: "upper") } permissions
settings-permissions-permission = Permission
settings-permissions-held-by = Held by
settings-permissions-remove-holder = Remove { $holder } from { $permission }
settings-permissions-add = Add
# What stands after Add for a reader who hears it, naming the permission.
settings-permissions-add-to = to { $permission }
settings-permissions-add-title = Add holder
settings-permissions-nothing = Nothing to add
settings-permissions-holder = Holder
settings-permissions-filter = Filter
settings-permissions-choose = Choose

## The site's workspaces, and its workspace links.

settings-workspaces-title = { -workspace(case: "upper", form: "plural") }
settings-workspaces-withheld = { -site(case: "upper", form: "a") } { -role-admin } creates { -workspace(form: "plural") }
settings-workspaces-count = { $count ->
    [one] { $count } { -workspace }
   *[other] { $count } { -workspace(form: "plural") }
}
settings-workspaces-unnamed = { $count } unnamed
settings-workspaces-unnamed-more = +{ $count } more
settings-workspaces-workspace = { -workspace(case: "upper") }
settings-workspaces-admins = { -role-admin(case: "upper", form: "plural") }
settings-workspaces-invites = { -invite(case: "upper", form: "plural") }
# spells -invite: to invite is a verb here
settings-workspaces-create-accounts = Can invite new people
settings-workspaces-new-people = New people
settings-workspaces-existing-accounts = Existing accounts
settings-workspaces-name-taken = Name taken
settings-workspaces-not-permitted = Not permitted
settings-workspaces-created = { $tenant } created · { $github } signs in with { -github }
settings-workspaces-new = New { -workspace }
settings-workspaces-name = Name
settings-workspaces-owner = Owner
settings-workspaces-create = Create
settings-workspaces-note = Note
settings-workspaces-note-lines = One line

## The workspace's connected GitHub accounts.

settings-accounts-title = { -github } accounts
settings-accounts-about = Connected accounts and their apps
settings-accounts-table = Connected accounts
settings-accounts-none = No account connected
settings-accounts-add = Add account
settings-accounts-account = Account
settings-accounts-kind = Kind
settings-accounts-portal = { -portal-app(case: "upper") }
settings-accounts-worker = { -worker-app(case: "upper") }
settings-accounts-kind-user = User
settings-accounts-kind-organization = Organization
settings-accounts-installed = Installed
settings-accounts-missing = Missing
settings-accounts-update-pending = Update pending
settings-accounts-review = Review on { -github }
