# Wayfinder maps (local-markdown tracker)

This directory is the issue tracker for wayfinder maps in this repo. Every map and ticket is a Markdown file.

## Layout

```
.wayfinder/<map-slug>/map.md              the map (label wayfinder:map)
.wayfinder/<map-slug>/tickets/NN-slug.md  its child tickets
```

## Wayfinding operations

- **Identity and name.** A ticket's id is its `NN` number and its name is its `title`. Refer to a ticket by
  its title, linked to the file.
- **Ticket type.** `labels` holds exactly one of `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling` or `wayfinder:task`.
- **Claim.** Set `assignee` before any work. An open ticket with an empty `assignee` is unclaimed.
- **Blocking.** `blocked_by` lists the ids of the tickets that block this one. A ticket is unblocked when
  every ticket it lists has `status: closed`.
- **Frontier.** The open, unblocked, unclaimed tickets. List the candidates with
  `grep -l 'status: open' .wayfinder/<map-slug>/tickets/*.md`, then check `assignee` and `blocked_by`.
- **Resolve.** Append a `## Resolution` section (the resolution comment) with the date, set `status: closed`,
  and add a one-line pointer to the map's Decisions so far.
- **Out of scope.** Set `status: closed`, add `## Out of scope` with the reason, and list the ticket in the
  map's Out of scope section instead of Decisions so far.
- **Assets.** Link prototypes, research notes and branches from the ticket. Do not paste them in.
