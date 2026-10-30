# Authoring a changeset

Update the changeset that the PR already has. If it has none, create one file, `.changeset/<descriptive-name>.md`, for the complete PR:

```md
---
"@my-workspace/core": patch
---

Fix `loadConfig` returning a stale value when the file changes while it loads.
```

Write one short sentence, usually under 25 words, that names the changed API and says what consumers will notice. That sentence is the whole entry, unless the change is breaking or consumers must migrate.

Leave out how the change works: internal modules, algorithms, data structures, refactors, motivation, benchmarks, tests, and history. They belong in the PR description. Cut each sentence that a consumer would not act on.

- Bad: "Rework the `MemoMap` lookup so `Layer.provide` checks identity before building, adding a cache keyed by layer reference and tests for shared layers."
- Good: "Fix composed layers being rebuilt for every parent that references them."

Add detail only for a break or a required migration: what existing code must change, and how. When several breaks need migration steps, write one compact bullet for each break, or a `### Breaking changes` section when the reader must scan them separately. Add before and after examples only when they make the migration clearer. Several non-breaking fixes or additions still share one sentence.

List each published package that the PR changes directly. Leave out a package that is in the frontmatter only because it shares a `fixed` group in `.changeset/config.json`.

Choose the bump by semver:

- `patch` for compatible fixes, `minor` for compatible additions, and `major` for breaks.
- Use `major` only when a maintainer approved a major release. Ask when the release intent is not clear.

Check the frontmatter against the published package names, and read the pending changesets in `.changeset/` and the package's `CHANGELOG.md` for the conventions of the repository. Match their form, not the length of the longer ones. Leave `pnpm changeset version` and `pnpm changeset publish` to the release process.
