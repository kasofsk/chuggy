## The repositories page, a repository's page, adding one, and connecting
## GitHub: `RepositoriesPage.tsx`, `repositories/`, the two pages the forge
## returns to, and the core modules they draw from.

## The words a refusal that says nothing about the repository is drawn as.

repositories-refused = Refused
repositories-not-found = Not found
repositories-conflict = Conflict
repositories-signed-out = Not signed in
repositories-failed = Failed
repositories-unreachable = Unreachable
repositories-unreadable = Unreadable
repositories-unavailable = Unavailable
repositories-deferring = Deferring
repositories-not-configured = Not configured
repositories-not-installed = Not installed
repositories-github-unavailable = { -github } unavailable
repositories-more = { $count } more

## What a person brings back from the forge, and the two pages it returns to.

repositories-return-declined = Declined
repositories-return-partial = Partial
repositories-return-requested = Requested
# The forge spent the code before the api could read what it reaches.
repositories-return-spent = Start again
repositories-setup-title = Setup
repositories-callback-title = { -github }
repositories-connecting = Connecting
repositories-setup-unexpected = Not expected
repositories-setup-updated = Back from { -github }
repositories-home = Home
repositories-continue = Continue

## Connecting accounts and installing the apps.

repositories-connect-github = Connect { -github }
repositories-install-portal = Install portal
repositories-install-worker = Install worker
repositories-portal-app = { -portal-app(case: "upper") }
repositories-worker-app = { -worker-app(case: "upper") }
repositories-accounts-withheld = { -workspace(case: "upper", form: "a") } { -role-admin } connects { -github } accounts

## The page, and the line under Add.

repositories-title = { -repository(case: "upper", form: "plural") }
repositories-about = What this { -project } is connected to. { -ticket(case: "upper", form: "a") } names one of these.
repositories-none = No { -repository } connected
repositories-add = Add
repositories-add-how = Add, choose the { -repository }, then set up both apps for it · { setup-program } adds it itself
repositories-bound-caption = Connected { -repository(form: "plural") }
repositories-col-repository = { -repository(case: "upper") }
repositories-bound = Connected
repositories-unbind = Disconnect
repositories-offers-withheld = { -workspace(case: "upper", form: "a") } { -role-admin } adds { -repository(form: "plural") }
repositories-offers-failed = Accounts failed to load
repositories-offers-not-configured = { -github } not configured · ask an operator
repositories-offers-connect = No { -github } account connected yet
repositories-offers-portal-missing = No account has the { -portal-app }
repositories-offers-worker-missing = { -worker-app(case: "upper") } missing · { $account }

## The worker app's reach on a connected row, and the picker's roster.

repositories-worker-missing = { -worker-app(case: "upper") } missing
repositories-reach-unselected = The { -worker-app }'s installation { $installation } does not select this { -repository }.
repositories-reach-unclaimed = No { -worker-app } installation is connected on { $account }.
repositories-reach-unread = { -worker-app(case: "upper") } unread
repositories-reach-unknown = { -github } did not say whether the { -worker-app } reaches this { -repository }.
repositories-reach-review = Review on { -github }
repositories-filter = Filter
repositories-unlisted = Unlisted
repositories-unbound = Disconnected
repositories-truncated = More than shown

## Connecting one repository: which it is, then both apps on it, then done.

repositories-connect-which = Which { -repository } is this for?
repositories-connect-name = { -repository(case: "upper") }
repositories-connect-name-hint = owner/name, or its { -github } address
repositories-connect-name-invalid = Write it as owner/name, or paste its { -github } address.
repositories-connect-next = Continue
repositories-connect-listed = Or pick one { -brand-name } can see already:
repositories-connect-title = Connecting { $repository } to { $project }
repositories-connect-another = Choose another
repositories-connect-apps = { -brand-name } needs two { -github } apps on { $repository }.
# spells -work-stage: the work a ticket asks for, in general
repositories-connect-reason-worker = Pushes { -ticket } work to branches and opens { -pull-request(form: "plural") }.
# spells -work-stage: the work a ticket asks for, in general
repositories-connect-reason-portal = Merges finished work into protected branches such as main.
repositories-connect-reaches = Connected to { $repository }
repositories-connect-ungranted = Installed on { $account }, not let into { $repository } yet
repositories-connect-uninstalled = Not installed on { $account } yet
repositories-connect-install = Install on { -github }
repositories-connect-let-in = Let it in on { -github }
# spells -repository: GitHub's own labels
repositories-connect-choose-install = On { -github }, install it on { $account }, then choose "Only select repositories" and pick { $repository }, or choose "All repositories".
repositories-connect-choose-chosen = { -github } opens with { $account } and { $repository } already chosen.
# spells -repository: GitHub's own label
repositories-connect-choose-settings = On { -github }, under "Repository access", add { $repository } and save.
repositories-connect-left = { $count ->
        [one] Left to do: the { $app ->
            [portal] { -portal-app }
           *[worker] { -worker-app }
        }.
       *[other] Left to do: both apps.
    }
repositories-connect-requested = { -github } asked an owner of { $account } to approve the install. Once they have, this page shows it.
repositories-connect-spent = Stopped asking { -github } for now. Look again once the installs are done.
repositories-connect-reread = Look again
repositories-connect-unseen = Installed on { -github } already, but shown here as not installed?
repositories-connect-adding = Adding { $repository } to { $project }…
repositories-connect-done = { $repository } is connected to { $project }.
repositories-connect-done-app = { $app ->
        [portal] { -portal-app(case: "upper") }
       *[worker] { -worker-app(case: "upper") }
    }: connected to { $repository }
# spells -thread: the person's chat with their agent, where setup runs
repositories-connect-back-setup = Go back to the chat: setup carries on there.
repositories-connect-back-list = Show it in the list

## What connecting, a configuration step and disconnecting came to.

repositories-bound-named = { $repository } · { $status }
repositories-bound-already = { $repository } · Already connected
repositories-bound-elsewhere = Connected elsewhere
repositories-configurations-imported = { -configuration(case: "upper", form: "plural") } imported
repositories-configuration-added = Default { -configuration } added
repositories-ignored = { $count ->
    [one] { $count } other item in { $directory } is not a { -brand-name } { -configuration } and is ignored.
   *[other] { $count } other items in { $directory } are not { -brand-name } { -configuration(form: "plural") } and are ignored.
}
repositories-ignored-more = { $count }+ other items in { $directory } are not { -brand-name } { -configuration(form: "plural") } and are ignored.
repositories-ignored-some = Other items in { $directory } are not { -brand-name } { -configuration(form: "plural") } and are ignored.
repositories-new-ticket = New { -ticket }
repositories-deferred = Deferred
repositories-retry = Retry
repositories-step-imported = Imported
repositories-step-added = Added
repositories-deferral-not-configured = No { -configuration } step · ask an operator
repositories-deferral-no-bootstrap-image = No worker image · ask an operator
repositories-deferral-default-branch-absent = Empty { -repository } · push a commit
repositories-deferral-repository-absent = Not connected · connect again
repositories-deferral-snapshot-absent = Head unreadable
repositories-deferral-snapshot-refused = Unreadable { -configuration(form: "plural") } · fix the { -repository }
repositories-deferral-declarations-refused = Invalid { -configuration(form: "plural") } · fix the { -repository }
repositories-deferral-identity-conflict = { -configuration(case: "upper") } conflict · ask an operator
repositories-deferral-bootstrap-differs = Bootstrap differs · add { -configuration(form: "plural") }
repositories-deferral-stale-binding = Connection changed
repositories-deferral-project-not-found = { -project(case: "upper") } not found · ask an operator
repositories-deferral-step-failed = Step failed
repositories-unbind-question = Disconnect { $repository }?
repositories-unbind-line = New { -ticket(form: "plural") } can't name { $repository }. Existing { -ticket(form: "plural") } and their history stay. It can be added again, here or to another { -project }.

## A repository's page: its settings, what it declares, and its last import.

repositories-not-bound = Not connected
repositories-writing = Writing
repositories-written = Written
repositories-finalization-title = { -finalization(case: "upper") }
repositories-finalization-about = How a finished { -ticket } is { -finalization(form: "ed") }. { -ticket(case: "upper", form: "a") } may choose otherwise.
repositories-workflow-files = Workflow files
repositories-workflow-files-about = Lets { -run(form: "plural") } change workflow files · App needs Workflows
# spells -run: a GitHub Actions run, not a stage's
repositories-workflow-runs = Workflow runs
# spells -run: a GitHub Actions run, not a stage's
repositories-workflow-runs-about = Lets { -run(form: "plural") } start and read workflow runs · App needs Actions
repositories-off = Off
repositories-on = On
repositories-configurations-title = { -configuration(case: "upper", form: "plural") }
repositories-configurations-about = What this { -repository } declares under { $directory }.
repositories-configurations-none = No { -configuration } declared
repositories-configurations-caption = Declared { -configuration(form: "plural") }
repositories-configurations-partial = Not every { -configuration } was read
repositories-col-configuration = { -configuration(case: "upper") }
# The worker a workload runs on, never the worker app.
repositories-col-worker = { -workload(case: "upper") } worker
repositories-col-stages = { -stage(case: "upper", form: "plural") }
repositories-incomplete = Incomplete
repositories-catalog-work = { $work } of { $count ->
    [one] { $count } { -workload }
   *[other] { $count } { -workload(form: "plural") }
}
repositories-import-label = Last import
repositories-import-now = Import now
repositories-importing = Importing…
repositories-import-imported = Imported
repositories-import-undeclared = Undeclared
repositories-import-missing = Missing
repositories-import-empty = Empty
repositories-import-invalid = Invalid
repositories-import-stale = Stale
repositories-import-never = Never
repositories-import-refused-now = Not imported · { $word }
repositories-import-refused-label = Import refused
repositories-import-refused-file = { $path } · { $fault }
repositories-import-refused-files = { $path } · { $fault } · { $more } more

## Each fault a refused file is refused for.

repositories-fault-too-many-declarations = Too many files
repositories-fault-path-invalid = Path not allowed
repositories-fault-symlink-refused = Symlink
repositories-fault-content-too-large = File too large
repositories-fault-document-unreadable = Not JSON
repositories-fault-envelope-invalid = Not { -configuration(form: "a") } file
repositories-fault-name-invalid = Name invalid
repositories-fault-configuration-invalid = { -configuration(case: "upper") } invalid
repositories-fault-configuration-too-long = Too long
repositories-fault-duplicate-name = Name declared twice
repositories-fault-duplicate-path = File listed twice
repositories-fault-reference-absent = Referenced file missing
repositories-fault-too-many-references = Too many referenced files
repositories-fault-approval-outside-plan = { -approval(case: "upper") } outside { -evaluation-plan(form: "a") }
repositories-fault-chars = { $chars } of { $charsMax } characters
repositories-fault-reference-named = Missing { $reference }
