# Implement the ticket, with subagents

Read `.chug/prompts/work.md` and do the work exactly as it says. This prompt
adds one thing to it: how you may share the work.

You may hand bounded pieces of the work to subagents, and should where it saves
time: a search across the tree, a mechanical edit repeated over many files, a
first draft of tests for a module you have specified.

Give a clear piece that needs no judgement to Sonnet and one that needs
reasoning to Opus, and brief each with what to do, which files, and what done
looks like.

Keep the design, the integration and every gate run yourself: subagents share
your working tree and its database, so only one of you runs a gate at a time,
and what a subagent returns is unreviewed work until you have read it.
