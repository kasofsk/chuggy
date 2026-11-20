## A project's connectors: `ConnectorsPage.tsx`, `connectors/` and
## `app/core/connectors.ts`.

connectors-title = { -connector(case: "upper", form: "plural") }
connectors-about = The cloud identities this { -project }'s { -run(form: "plural") } may be issued. None holds a secret.
connectors-none = No { -connector(form: "plural") }
connectors-none-about = { -connector(case: "upper", form: "a") } lets this { -project }'s { -run(form: "plural") } be issued a cloud identity, such as an AWS role, with no secret stored. A { -workload } asks for one by its credential name.
connectors-caption = The { -project }'s { -connector(form: "plural") }

## One connector as the list draws it.

connectors-name = Name
connectors-kind = Kind
connectors-credential-about = Put this in a { -configuration }'s credentials
connectors-copy = Copy { $credential }
connectors-not-set = Not set
connectors-switch-on = On
connectors-switch-off = Off
connectors-kind-aws = AWS
connectors-kind-gcp = Google Cloud
connectors-kind-azure = Azure
connectors-kind-anthropic = Anthropic

## Each kind's settings.

connectors-field-role-arn = Role ARN
connectors-field-session-tags = Session tags
connectors-session-tags-about = The { -run }'s token also carries its { -workspace }, { -project }, { -workload }, { -ticket } and { -repository } as AWS session tags, so a role's policy can require them.
connectors-session-tags-cost = Every role this { -connector } assumes must allow sts:TagSession in its trust policy, or AWS refuses the { -run }.
# spells -project: a Google Cloud project is Google's
connectors-field-project-number = Project number
connectors-field-pool = Identity pool
connectors-field-provider = Identity pool provider
connectors-field-service-account = Service account email
connectors-field-tenant-id = Tenant ID
connectors-field-client-id = Client ID
connectors-field-organization-id = Organization ID
connectors-field-federation-rule-id = Federation rule ID
connectors-field-service-account-id = Service account ID
# spells -workspace: an Anthropic workspace is Anthropic's
connectors-field-workspace-id = Workspace ID
connectors-optional = { $label } (optional)

## What is wrong with a form, beside the field it concerns.

connectors-fault-name = Lower-case letters, digits and hyphens, starting and ending with a letter or digit, at most { $chars } characters.
connectors-fault-identifier = No spaces or braces.
connectors-fault-role-arn = An IAM role ARN, starting arn: with no spaces or braces.
# spells -project: a Google Cloud project is Google's
connectors-fault-project-number = The Google Cloud project's number, digits only.
connectors-fault-email = An email address with no spaces or braces.
connectors-refused-limit = This { -project } already holds { $count } { -connector(form: "plural") }, as many as it may. Remove one to add another.
connectors-refused-shape = The server refused this { -connector }'s settings.
connectors-refused-stale = This { -connector } changed since this page read it. The list has been read again, and what you typed is kept.
connectors-refused-fields = Some fields above need another look.

## Adding, changing and removing one.

connectors-add = Add { -connector }
connectors-adding = Adding
connectors-change = Change
connectors-change-named = Change { $name }
connectors-change-title = Change { $name }
connectors-saving = Saving
connectors-save = Save
connectors-remove = Remove
connectors-remove-named = Remove { $name }
connectors-remove-question = Remove { $name }?
connectors-remove-line = { -run(case: "upper", form: "plural") } whose { -configuration } lists { $credential } will fail until a { -connector } named { $name } is added again.

## Who changed what, and when.

connectors-history = History
connectors-history-about = Who changed which { -connector }, and when, newest first.
connectors-history-none = No changes yet
connectors-history-caption = Changes to the { -project }'s { -connector(form: "plural") }
connectors-history-when = When
connectors-history-who = Who
connectors-history-what = What
connectors-history-created = Added { $name }
connectors-history-changed = Changed { $name }
connectors-history-removed = Removed { $name }
connectors-history-older = Show older changes
