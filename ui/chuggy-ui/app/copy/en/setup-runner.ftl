## Setting up a runner: what a run of the setup program's runner command
## found, did and stopped on. A stop is what was found, what the person is
## told, and the condition its rule names; each condition begins with once, if
## or when and has no full stop, since the rule ends the sentence.

## Shared words.

setup-runner-unchanged = so nothing was changed on this machine
setup-runner-mac-none = { setup-program } puts { -runner(form: "a") } only on Linux
setup-runner-picked-up = What was done before it stays done, and running again picks up from there. Tell me if you want me to try again.
setup-runner-unknown = so I cannot say the { -runner } is set up. What was done before stays done
setup-runner-when-try-again = if the person asks to try again
setup-runner-when-look-again = if the person asks to look again
setup-runner-when-elsewhere = once the person says { -runner(form: "a") } is running on another machine
setup-runner-when-admin = once the person says they are { -role-admin(form: "a") } of { $project }
# A program and the version it said; both are data.
setup-runner-versioned = { $program } { $version }
# The rule a stop ends on, naming the one command it may be run again as.
# spells -run: to run is a verb here
setup-runner-rule = Run { $command } only { $when }.

## Each kind of Claude credential: what it is called, and what makes one.

setup-runner-claude-subscription = { -claude } login
# spells -claude: claude setup-token is the command
setup-runner-claude-subscription-made = the login the command claude setup-token makes, which needs a { -claude } plan that allows it
setup-runner-claude-api-key = Anthropic API key
# spells -workspace: a Claude Console workspace is Anthropic's, not the tenant
setup-runner-claude-api-key-made = a key from the { -claude } Console, made in a workspace
setup-runner-claude-bedrock = Bedrock credential
setup-runner-claude-bedrock-made = a Bedrock API key
setup-runner-claude-vertex = Google Cloud service account key
setup-runner-claude-vertex-made = the JSON key Google Cloud made for a service account
setup-runner-claude-foundry = Foundry API key
setup-runner-claude-foundry-made = a key of the Microsoft Foundry resource
setup-runner-claude-kept = readable only by you (mode 600)
setup-runner-claude-saved = It is { $made }, saved alone in { $path } and { setup-runner-claude-kept }.
# The key names are an AWS credentials file's own, which is code.
setup-runner-claude-saved-profile = It is an AWS credentials file, saved in { $path } and { setup-runner-claude-kept }, whose [{ $profile }] profile holds aws_access_key_id and aws_secret_access_key.

## What a run found and did.

setup-runner-note-engine = { $engine } answers you without a password
setup-runner-note-package = the { -runner } package is installed: { $versioned }, at { $command }
setup-runner-note-outdated = the { -runner } package is installed: { $versioned }, at { $command }, and { setup-program } needs { $least } or later
setup-runner-note-outdated-unread = the { -runner } package is installed: { $versioned }, at { $command }, and { setup-program } needs { $least } or later and could not read its version
setup-runner-note-installed = installed the { -runner } package, { $versioned }, at { $command }
setup-runner-note-installed-kept = installed the { -runner } package, { $versioned }, at { $command }, and { $kept } is still at { $where }
setup-runner-note-settings = the { -runner }'s settings are in { $path }
setup-runner-note-settings-written = wrote the { -runner }'s settings to { $path }: its guide's own, with { $engine } as the engine
setup-runner-note-login = the { -runner }'s { $credential } is in { $path }
setup-runner-note-pool = this machine is registered as { -runner(form: "a") } of { $project }, in { $path }
setup-runner-note-pool-gone = { $path } registered this machine as { $pool }, and the { -site } lists no { -runner } of { $project } by that name
setup-runner-note-registered = registered this machine as { -runner(form: "a") } of { $project }, in { $path }
# spells -brief-check: the runner package's own check is no brief's
setup-runner-note-checked = the { -runner }'s own check passed
# spells -brief-check: the runner package's own check is no brief's
setup-runner-note-checked-warned = the { -runner }'s own check passed, with a warning: { $warned }
setup-runner-note-unit = the { -runner }'s service is installed: { $unit }
setup-runner-note-unit-written = installed the { -runner }'s service, { $unit }
setup-runner-note-linger = your services keep running after you log out
setup-runner-note-linger-on = set your services to keep running after you log out
setup-runner-note-linger-on-unread = set your services to keep running after you log out, not having learned whether they already did
setup-runner-note-running = { $unit } is enabled and running
setup-runner-note-enabled = set { $unit }, which was running, to start when you log in
setup-runner-note-started = started { $unit }, which also starts when you log in
# spells -run: to run is a verb here
setup-runner-note-restarted = restarted { $unit }, so it runs as it is now registered and installed
setup-runner-note-project-live = the { -site } sees { -runner(form: "a") } of { $project } live
# spells -work-stage: the work in general
setup-runner-note-hosted = { -hosted-runs } take the work of { $project }, so that work needs no { -runner }
setup-runner-note-chat-host = this machine is registered as your { -chat-host }, in { $path }
setup-runner-note-chat-host-gone = { $path } registered this machine as your { -chat-host }, and the { -site } no longer knows that registration
setup-runner-note-chat-host-registered = registered this machine as your { -chat-host }, in { $path }
# spells -brief-check: the chat host's own check is no brief's
setup-runner-note-chat-checked = the { -chat-host }'s own check passed
# spells -brief-check: the chat host's own check is no brief's
setup-runner-note-chat-checked-warned = the { -chat-host }'s own check passed, with a warning: { $warned }
setup-runner-note-chat-unit = your { -chat-host }'s service is installed: { $unit }
setup-runner-note-chat-unit-written = installed your { -chat-host }'s service, { $unit }
# spells -run: to run is a verb here
setup-runner-note-chat-host-live = the { -site } sees this machine live as your { -chat-host }, so your { -thread(form: "plural") } in { $project } can run on it
# spells -run: to run is a verb here
setup-runner-note-chat-host-elsewhere = the { -site } sees your { -chat-host } live on another machine, so your { -thread(form: "plural") } in { $project } run there

## The container engines, and how one did not answer.

setup-runner-engine-docker = Docker
setup-runner-engine-podman = Podman
setup-runner-engine-absent = { $engine } is not installed
setup-runner-engine-silent = { $engine } did not answer you without a password
# Two of the lines above, as one found line says them.
setup-runner-engine-each = { $one }; { $other }
setup-runner-engines-one = { $engine }, the engine the { -runner } is set to use, did not answer
setup-runner-engines-nor = { $one } nor { $other }
setup-runner-engines-neither = neither { $engines } answered
setup-runner-engine-needs-password = Installing a container engine, or letting your user reach one, takes a password, and { setup-program } never takes one.
# spells -work-stage: the work in general
setup-runner-engineless-tell = { -runner(case: "upper", form: "a") } does its work in containers, and { $none } on this machine without a password, { setup-runner-unchanged }. { setup-runner-engine-needs-password } Tell me once one answers you.
setup-runner-engineless-when = once the person says a container engine answers them on this machine

## A user the runner package takes docker from no user but one.

# spells -work-stage: the work in general
# spells -run: to run is a verb here
setup-runner-docker-why = Under docker { -runner(form: "a") }'s work runs as this machine's user { $job }, which could not read the file your { -claude } credential is in, so the { -runner } package takes docker only from that user, and you are { $who }.
setup-runner-docker-who = user { $user }
setup-runner-docker-who-unnumbered = not that user
setup-runner-docker-podman-instead = The package's own answer for any other user is rootless podman
setup-runner-docker-only = the { -runner } package takes docker only from this machine's user { $job }
setup-runner-docker-named-found = the { -runner } is set to use docker, in { $settings }, and { setup-runner-docker-only }
setup-runner-docker-named-state = The { -runner }'s settings, { $settings }, set it to use docker
# The key and its value are the settings file's own, which is code.
setup-runner-docker-named-mend = { setup-runner-docker-podman-instead }: once podman answers you, set "engine" to "podman" in that file, and tell me once you have.
setup-runner-docker-named-when = once the person says { $settings } names podman
setup-runner-docker-podmanless-found = { $none }, and docker was not asked: { setup-runner-docker-only }
setup-runner-docker-podmanless-state = { setup-runner-docker-podman-instead }, and { $none }
setup-runner-docker-podmanless-mend = { setup-runner-engine-needs-password } Tell me once podman answers you.
setup-runner-docker-podmanless-when = once the person says podman answers them on this machine
setup-runner-docker-tell = { $why } { $state }, { setup-runner-unchanged }. { $mend }

## What the site was asked and did not give.

# spells -work-stage: the work in general
# spells -run: to run is a verb here
setup-runner-read-work = where its work runs
# spells -run: to run is a verb here
setup-runner-read-threads = where your { -thread(form: "plural") } in it run
setup-runner-read-placement = how its { -runner(form: "plural") } stand
setup-runner-read-pools = which { -runner(form: "plural") } it has
setup-runner-read-permit = whether you may register { -chat-host(form: "a") }
setup-runner-read-chat = whether you have { -chat-host(form: "a") }
setup-runner-unread-refused-found = the { -site } does not show you { $project } or { $what }
setup-runner-unread-refused-tell = The { -brand-name } { -site } does not show you what { -runner(form: "a") } for { $project } is set up from, { $left }. { -role-admin(case: "upper", form: "a") } of the { -workspace } can see it, or can give you the access to. Tell me if your access changes.
setup-runner-unread-refused-when = if the person says their access has changed
# The outcome is the reading's own name for how it failed, which is code.
setup-runner-unread-found = the { -site } did not say of { $project } { $what } ({ $outcome })
setup-runner-unread-tell = The { -brand-name } { -site } did not answer everything I asked it, { setup-runner-unknown }. Tell me if you want me to try again.
setup-runner-not-admin-found = the { -site } says you are not { -role-admin(form: "a") } of { $project }
setup-runner-not-admin-tell = Putting { -runner(form: "a") } on { -project(form: "a") } takes { -role-admin(form: "a") } of it, and the { -brand-name } { -site } says you are not one of { $project }, { setup-runner-unchanged }. Ask { -role-admin(form: "a") } to make you one. Tell me once you are.

## What this machine lacks.

setup-runner-mac-found = this machine is a Mac, and { setup-runner-mac-none }
# spells -run: to run is a verb here
setup-runner-mac-tell = { setup-runner-mac-none } and cannot set one up here, { setup-runner-unchanged }. A Mac runs one with { $program }, added by hand, and a Linux machine runs one too. Tell me once one is running.
setup-runner-mac-when = once the person says { -runner(form: "a") } is running
setup-runner-serviceless-found = this machine's user services did not answer { $command }
# spells -run: to run is a verb here
setup-runner-serviceless-tell = { setup-program } runs the { -runner } as a service of yours, and this machine's user services did not answer, { setup-runner-unchanged }. The { -runner }'s guide says how it is run by hand: { $guide }. Tell me if you want me to try again.
setup-runner-settings-unread-found = { $path } is there and does not read as the { -runner }'s settings
setup-runner-settings-unread-tell = The { -runner }'s settings file, { $path }, is there, and { setup-program } could not read from it which engine and which { -claude } credential the { -runner } uses, { setup-runner-unchanged }. The { -runner }'s guide says what the file holds: { $guide }. Tell me once it is mended.
setup-runner-settings-unread-when = once the person says { $path } is mended
setup-runner-login-missing-found = the { -runner } has no { $credential } on this machine: nothing is at { $path }
setup-runner-login-missing-tell = The { -runner } needs a { -claude } login of its own on this machine, and there is none at { $path }, { setup-runner-unchanged }. { $saved } An Anthropic API key or a cloud provider's credential can be used instead; the { -runner }'s guide says how: { $guide }. Tell me once one is there.
setup-runner-login-missing-named-tell = The { -runner }'s settings name its { $credential } as { $path }, and nothing is there, { setup-runner-unchanged }. { $saved } Tell me once it is there.
setup-runner-login-missing-when = once the person says the { -runner }'s { $credential } is on this machine
setup-runner-npmless-found = the { -runner } package is not installed at a version { setup-program } can use, and npm did not answer
# spells -run: to run is a verb here
setup-runner-npmless-tell = The { -runner } package is installed with npm, and npm did not answer on this machine, { setup-runner-unchanged }. npm comes with Node. Tell me once npm runs here.
# spells -run: to run is a verb here
setup-runner-npmless-when = once the person says npm runs on this machine
setup-runner-unwritten-found = { setup-program } could not make { $path }
setup-runner-unwritten-tell = { setup-program } could not write the { -runner }'s settings to { $path } on this machine, so the { -runner } is not set up yet. { setup-runner-picked-up }
setup-runner-unwritten-when = once { $path } can be made

## The programs a run runs, as a sentence names each; `case` is "upper" where
## one begins it.

setup-runner-act-install = { $case ->
    [upper] Installing the { -runner } package
   *[lower] installing the { -runner } package
}
setup-runner-act-register = { $case ->
    [upper] Registering this machine
   *[lower] registering this machine
}
# spells -brief-check: the runner package's own check is no brief's
setup-runner-act-check = { $case ->
    [upper] The { -runner }'s own check
   *[lower] the { -runner }'s own check
}
setup-runner-act-service = { $case ->
    [upper] Installing the { -runner }'s service
   *[lower] installing the { -runner }'s service
}
setup-runner-act-register-chat = { $case ->
    [upper] Registering this machine as your { -chat-host }
   *[lower] registering this machine as your { -chat-host }
}
# spells -brief-check: the chat host's own check is no brief's
setup-runner-act-check-chat = { $case ->
    [upper] The { -chat-host }'s own check
   *[lower] the { -chat-host }'s own check
}
setup-runner-act-service-chat = { $case ->
    [upper] Installing your { -chat-host }'s service
   *[lower] installing your { -chat-host }'s service
}
setup-runner-act-reload = { $case ->
    [upper] Reloading your services
   *[lower] reloading your services
}
setup-runner-act-start = { $case ->
    [upper] Starting the { -runner }'s service
   *[lower] starting the { -runner }'s service
}
setup-runner-act-restart = { $case ->
    [upper] Restarting the { -runner }'s service
   *[lower] restarting the { -runner }'s service
}

## How a program that was run did not do what it was run for.

setup-runner-failed-unstarted = could not be started
setup-runner-failed-unended = did not end within { $secs } s and was stopped
setup-runner-failed-exit-silent = ended with exit { $exit } and said nothing
setup-runner-failed-exit = ended with exit { $exit }, saying: { $excerpt }
setup-runner-failed-unquoted = ended with exit { $exit }, and what it printed is not shown, since it was handed the registration token
setup-runner-failed-refused = ended with exit { $exit }: { $refusal }
setup-runner-failed-unseen = ended well, and what it makes is not at { $path }
setup-runner-act-found = { $act } { $failed }
# spells -work-stage: to work is a verb here
setup-runner-act-tell = { $act } did not work, so the { -runner } is not set up yet. { setup-runner-picked-up }
# spells -work-stage: to work is a verb here
setup-runner-service-refused-tell = { $act } did not work, so the { -runner } is not set up yet: the { -runner } package would not write it over the service already at { $path }. If that one is left from { -runner(form: "a") } set up before, remove it, and tell me once you have or if you want me to try again.
setup-runner-service-refused-when = once the person says { $path } is removed, or asks to try again
setup-runner-behind-found = installing the { -runner } package left { $left } at { $command }, and { setup-program } needs { $least } or later
setup-runner-behind-found-unread = installing the { -runner } package left { $left } at { $command }, and { setup-program } needs { $least } or later and could not read its version
# spells -release: a package's release
setup-runner-behind-tell = Installing the { -runner } package left { $left }, and { setup-program } needs { $least } or later here, so the { -runner } is not set up yet. { setup-program } installs the package's latest release, so running again now would install the same one. Tell me once a newer { $program } is out.
setup-runner-behind-when = once the person says a newer { $program } is out

## The runner package's refusals to register, each in this program's words.

setup-runner-refusal-node = the { -runner } package needs a newer Node than the node this machine's PATH finds first
# spells -run: to run is a verb here
setup-runner-refusal-processor = the { -runner } package does not run on this machine's kind of processor
setup-runner-refusal-hostname = this machine's name makes no name for { -runner(form: "a") }
setup-runner-refusal-directory = the { -runner } package could not make the directory it keeps registrations in
setup-runner-refusal-unanswered = the { -site } did not answer the { -runner } package
setup-runner-refusal-token = the { -site } did not take the registration token it had just made
setup-runner-refusal-again = the { -site } could not register this machine just then
setup-runner-refusal-pool-file = the { -runner } package could not write this machine's registration
setup-runner-lasting-node-tell = The { -runner } package needs a newer Node than the node this machine's PATH finds first, so the { -runner } is not set up yet. Running again under the same Node would end the same way. Tell me once node is newer.
setup-runner-lasting-node-when = once the person says node on this machine is newer
# spells -run: to run is a verb here
# spells -work-stage: the work in general
setup-runner-lasting-processor-tell = The { -runner } package does not run on this machine's kind of processor, so { setup-program } cannot set { -runner(form: "a") } up here. The work on your { -ticket(form: "plural") } needs { -runner(form: "a") } on a Linux machine it does run on. Tell me once one is running there.
setup-runner-lasting-hostname-tell = The { -runner } package names { -runner(form: "a") } after its machine, and this machine's name makes no name for one, so the { -runner } is not set up yet. Running again as the machine is named now would end the same way. Tell me once this machine's name starts with a letter from a to z or a digit.
setup-runner-lasting-hostname-when = once the person says this machine's name starts with a letter from a to z or a digit

## The site's registration token, not made.

# The outcome is the request's own name for how it failed, which is code.
setup-runner-mint-found = the { -site } made no registration token for { $project } ({ $outcome })
setup-runner-mint-absent-tell = The { -brand-name } { -site } would not make a registration for { $project }: that takes { -role-admin(form: "a") } of it. The { -runner } package is on this machine and nothing is registered. Tell me once you are { -role-admin(form: "a") } of { $project }.
setup-runner-mint-conflict-tell = { -brand-name } already holds as many unused registrations for { $project } as it keeps at once, so it made no more. Each lapses by itself within { $mins } minutes of being made. Tell me when you want me to try again.
setup-runner-mint-tell = The { -brand-name } { -site } did not make a registration for { $project }, so this machine is not registered yet. { setup-runner-picked-up }
setup-runner-chat-mint-found = the { -site } made no registration token for your { -chat-host } ({ $outcome })
setup-runner-chat-mint-absent-tell = The { -brand-name } { -site } would not make a registration for { -chat-host(form: "a") } of yours: the { -workspace } lets only { -role-member(form: "plural") } it chooses register one. Tell me once { -workspace(form: "a") } { -role-admin } has let you.
setup-runner-chat-mint-absent-when = once the person says { -workspace(form: "a") } { -role-admin } has let them register { -chat-host(form: "a") }
setup-runner-chat-mint-conflict-tell = { -brand-name } already holds as many unused registrations of yours as it keeps at once, so it made no more. Each lapses by itself within { $mins } minutes of being made. Tell me when you want me to try again.
setup-runner-chat-mint-tell = The { -brand-name } { -site } did not make a registration for your { -chat-host }, so this machine is not your { -chat-host } yet. { setup-runner-picked-up }

## The runner's own check, by what each check it names means.

setup-runner-check-pool-file = this machine's registration could not be read
setup-runner-check-configuration = the { -runner }'s settings are not as it needs them
# spells -run: to run is a verb here
setup-runner-check-runtime = the { -runner } has nowhere to keep what it runs with
setup-runner-check-credential = the { -runner }'s { -claude } credential is not as it needs it
setup-runner-check-helpers = podman would present logins of its own
setup-runner-check-engine = the { -runner } could not use the container engine
setup-runner-check-network = the { -runner } could not read its containers' network
setup-runner-check-pool-token = { -brand-name }'s sign-in server did not take this machine's registration
setup-runner-check-plane = { -brand-name } did not answer this machine as { -runner(form: "a") }
setup-runner-check-chat-credential = the { -claude } credential is not alone in a directory of its own, which { -chat-host(form: "a") } needs
setup-runner-check-chat-settings = the { -chat-host }'s settings are not as it needs them
# spells -run: to run is a verb here
setup-runner-check-chat-users = the container engine cannot run each { -thread } as a user of its own
setup-runner-check-chat-supervisor = a container left from an earlier { -chat-host } is in the way of this one
# spells -run: to run is a verb here
setup-runner-check-chat-image = the image the { -chat-host } runs could not be found or pulled
setup-runner-check-unpassed = { $check } did not pass
setup-runner-check-failed-runner = The { -runner } is installed and registered on this machine
setup-runner-check-failed-chat = This machine is registered as your { -chat-host }
setup-runner-check-failed-found = { $meant }; { $check } said: { $line }
# spells -brief-check: the runner package's own check is no brief's
setup-runner-check-failed-tell = { $what }, and its own check did not pass: { $meant }. What it said is: { $line }. Tell me once that is mended, or if you want me to try again.
setup-runner-check-failed-when = once the person says it is mended or asks to try again

## The runner's service.

setup-runner-linger-found = your services stop when you log out, and { setup-program } could not change that
setup-runner-linger-found-said = your services stop when you log out, and { setup-program } could not change that: loginctl said { $excerpt }
# spells -run: to run is a verb here
setup-runner-linger-tell = The { -runner } is installed and registered on this machine. For it to keep running after you log out, one command is yours to run, because it may ask for your password and { setup-program } never takes one. In a terminal of your own, run { $command } and tell me once you have.
# spells -run: "have run" is the verb, not the noun
setup-runner-linger-when = once the person says they have run it
setup-runner-inactive-started = was started and
setup-runner-inactive-waited = was running and after { $secs } s
setup-runner-inactive-silent-found = { $unit } { $was } this machine's user services did not answer whether it is running
setup-runner-inactive-silent-tell = This machine's user services did not answer when I asked whether the { -runner }'s service is running, so I cannot say the { -runner } is set up. { setup-runner-picked-up }
# The state is the service manager's own word, which is data.
setup-runner-inactive-found = { $unit } { $was } is { $state }
setup-runner-inactive-not-running = not running
setup-runner-inactive-tell = The { -runner }'s service was started and is not running, so the { -runner } is not set up yet. { setup-runner-picked-up }
setup-runner-not-live-found = the { -runner }'s service is running, and after { $secs } s the { -site } still sees no { -runner } of { $project } live
setup-runner-not-live-unregistered-found = the { -runner }'s service is running, and after { $secs } s the { -site } lists no { -runner } of { $project }
setup-runner-not-live-tell = The { -runner } is installed, registered and started on this machine, and the { -brand-name } { -site } does not see it live yet. It can take a little longer. Tell me when you want me to look again.

## The person's chat host.

setup-runner-permit-found = the { -workspace } does not let you register { -chat-host(form: "a") }
# spells -work-stage: the work in general
setup-runner-permit-runner = The { -runner } for the work on { $project } is set up and live.
# spells -work-stage: the work in general
setup-runner-permit-hosted = { -hosted-runs(case: "upper") } take the work on { $project }.
# A page and a button are named as the console draws them.
# spells -run: to run is a verb here
# spells -turn: to turn on is a verb here
setup-runner-permit-tell = { $work } Your { -thread(form: "plural") } there run only on your { -chat-host }, and the { -workspace } does not let you register one yet. { -role-admin(case: "upper", form: "a") } of the { -workspace }, you if you are one, turns on { -personal-runner(case: "upper", form: "plural") } for you on its People page, { $people }, with Edit on your row. Tell me once it is on.
setup-runner-permit-when = once the person says { -personal-runner(case: "upper", form: "plural") } is on for them in the { -workspace }
setup-runner-offline-found = your { -chat-host } is another machine, registered and not running
# spells -run: to run is a verb here
setup-runner-offline-tell = Your { -thread(form: "plural") } in { $project } run only on your { -chat-host }, which is another machine, registered and not running. { -role-member(case: "upper", form: "a") } has one { -chat-host }, so making this machine it would replace that one. Start it on its machine, or remove it on your { -personal-runner(case: "upper", form: "plural") } page, { $runners }, for this machine to be it instead. Tell me once you have done either.
setup-runner-offline-when = once the person says their { -chat-host } is running, or that they removed it
setup-runner-chat-login-linked-why = is handed the { -runner }'s { $credential } only as a file of its own, and { $path } is a symbolic link
setup-runner-chat-login-shared-why = is handed the directory of the { -runner }'s { $credential } whole, and { $path } shares its directory with other files
# The setting's name is the settings file's own, which is code.
setup-runner-chat-login-token-copy = Copy the token itself alone to { $login }, { setup-runner-claude-kept }, and set claudeTokenFile in { $settings } to { $login }.
setup-runner-chat-login-copy = Copy it alone into a directory of its own, such as { $directory }, readable only by you, and change where { $settings } names it to the copy.
setup-runner-chat-login-linked-found = the { -runner }'s { $credential }, { $path }, is a symbolic link, which your { -chat-host } is not handed
setup-runner-chat-login-shared-found = the { -runner }'s { $credential }, { $path }, is not alone in its directory, which your { -chat-host } is handed whole
setup-runner-chat-login-tell = Your { -chat-host } { $why }, so this machine is not your { -chat-host } yet. { $copy } Then restart this machine's { -runner } services, which read the settings only as they start: { $restart }. The old one can go once they have. Tell me once they have restarted.
setup-runner-chat-login-when = once the person says the { -runner }'s { $credential } is copied alone into a directory of its own and its services have restarted
setup-runner-chat-not-live-found = your { -chat-host }'s service is running, and after { $secs } s the { -site } still does not see this machine live as your { -chat-host }
setup-runner-chat-not-live-tell = Your { -chat-host } is installed, registered and started on this machine, and the { -brand-name } { -site } does not see it live yet. It can take a little longer. Tell me when you want me to look again.
