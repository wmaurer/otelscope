---
id: "09"
title: Route tree and URL state
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: [03, 08]
---

## Question

What are the routes, and what state lives in them? Settle:

- the route tree for runs, traces, the trace view and the body viewer;
- what is a path param and what is a search param (selected span, folded nodes, filters, focused pane);
- how live data updates interact with routes (loaders, or subscriptions in components);
- whether TanStack Router's four workarounds (redirecting the `isServer` import, `origin`, global stubs, no
  `<Link>`) and its upstream fragility are worth it, or the typed state router fallback of about 50 lines is
  better.

The TanStack research found it viable with those workarounds, and recommends routes for identity and view
state, with components subscribing to the store directly. See `docs/research/tanstack-router-under-opentui.md`
on branch `research/tanstack-router-under-opentui`.

From the data-layer ticket: traces are keyed by trace id alone and can belong to more than one run, so a trace
route must not assume one parent run. On a file Reset every id can disappear, and a route that points at a
missing trace or span needs a fallback.
