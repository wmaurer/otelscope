---
id: "03"
title: TanStack Router under OpenTUI's React renderer
labels: [wayfinder:research]
status: closed
assignee: research-agent
blocked_by: []
---

## Question

Does `@tanstack/react-router` work under a non-DOM React reconciler such as OpenTUI's? Find out:

- whether `createRouter` with `createMemoryHistory`, `RouterProvider`, `Outlet`, `useNavigate`,
  `useParams` and `useSearch` run without `window` or `document`, and which pieces assume the DOM
  (`Link` rendering `<a>`, scroll restoration, devtools, preloading on hover);
- whether search-param validation accepts an Effect `Schema` (Standard Schema) or needs an adapter;
- how route loaders and invalidation would sit beside a live, push-based data source;
- any known terminal or React Native style usage, and compatibility with the React version OpenTUI needs.

If it is not viable, say what breaks and name the lightest alternative: a small typed state router, or
TanStack's history package alone.

Sources: the published package source on npm (read `src/` of the installed version), official docs, and
OpenTUI's reconciler in `.repos/deps/opentui/packages/react/`.

## Resolution

2026-10-07, by research agent. Findings: `docs/research/tanstack-router-under-opentui.md` on branch
`research/tanstack-router-under-opentui` (commit 2d53b75). Verified with a throwaway experiment on OpenTUI's
test renderer (Bun 1.4.0, `@tanstack/react-router@1.170.41`, `@opentui/react@0.5.14`, `react@19.2.8`,
`effect@4.0.1`).

- **Verdict: viable, with four adjustments.** Memory history, `RouterProvider`, `Outlet`, key-driven
  `useNavigate`, `useParams`, `useSearch`, loaders, `router.invalidate()` and `history.back()` all work, in
  React dev, production and bundled builds.
    1. Out of the box `@tanstack/router-core/isServer` resolves to `isServer = true` under Bun and Node, and the
       first render crashes. The recommended fix is a bundler plugin that redirects that one import to the
       client build. `--conditions=browser` also works but switches every package (`ws` becomes a stub that
       throws). `--conditions=development` with `isServer: false` works too.
    2. Pass `origin: "http://localhost"`.
    3. Stub `globalThis.scrollTo`, and on Node also `self`.
    4. Don't use `<Link>`: OpenTUI renders `<a>` as a terminal hyperlink that cannot navigate. Navigate from key
       handlers.
- **DOM-only, unusable:** preloading, scroll restoration, devtools, and `useBlocker`, which silently never
  blocks. `react-dom` must be installed as a peer but is never loaded.
- **Effect Schema search params:** wrap with `Schema.toStandardSchemaV1(...)`; no adapter is needed. Typing
  works on both sides. Avoid transforming schemas: `NumberFromString` fails the round trip, because search
  values are JSON-parsed.
- **Live data:** routes carry identity (run id, trace id) and view state (selected span, pane, filters).
  Components subscribe to the Effect store directly. Loaders are optional and should be cheap. Don't call
  `router.invalidate()` per pushed span.
- **Prior art:** `msmps/opentui-examples` has a TanStack Router demo. TanStack issue #7472 records a break in
  non-browser hosts at `1.157.6`, and the maintainers say the router targets the browser.
- **Risk:** minor releases have broken non-browser hosts. Pin exact versions and keep a smoke test.
- **Fallback:** a typed state router of about 50 lines (a union of screens plus a back stack).
