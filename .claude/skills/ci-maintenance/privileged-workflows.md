# Privileged workflows

- A privileged job never runs untrusted repository code while it holds secrets or write credentials.
- Validate data from another run for its expected source, identity, type, shape, and a size limit before a command, output, API call, or comment uses it.
- Put the intended approval step between work that starts in a fork and privileged execution.
- Let publishing and other operations that cannot be undone run to the end. Cancel only checks and previews that a new run replaces.
- Set the checkout revision and credential persistence explicitly. Account for every write permission and every credential.

To find the nearest precedent, search the current workflows by event, job purpose, action, and permission. Look for fork approval gates, publishing, concurrency that does not cancel, and validation of artifacts from another run before privileged use.

Read the current GitHub documentation for the semantics of events, tokens, secrets, permissions, checkout, artifacts, reusable workflows, and environments. Start with the references for workflow events, workflow syntax, and secure use.
