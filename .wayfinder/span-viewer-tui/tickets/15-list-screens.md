---
id: "15"
title: Run and trace list screens
labels: [wayfinder:prototype]
status: closed
assignee: wmaurer
blocked_by: [14]
---

## Question

How should the `Runs` and `Traces` screens look and behave? Build rough versions against the sample and large
fixtures (the trace-view prototype on `prototype/trace-view` can be extended) and settle:

- the columns of each list (name, start, duration, span count, exit counts, …) and their sort order;
- what marks a run or trace as live, partial or failed;
- how a run reads, given the answer to "Run identity: does the record carry the service name?";
- the keys for moving, opening and going back on these screens, in line with the trace view's keymap;
- how a list behaves while new records arrive (rows inserted, selection kept by id).

The view state each screen carries in the typed stack is part of the answer.

## Resolution

2026-10-08, prototyped and reviewed with wmaurer. Prototype: `prototypes/list-screens/` on the throwaway branch
`prototype/list-screens` (commit 01a7891), which extends the trace view prototype with four list variants over
a fake file of about 57 runs with `service` stamped on each record, plus a slowed live replay. Its `NOTES.md`
lists the variants that lost: B (runs grouped by service, a preview pane) and C (runs by day with sparklines,
traces as a waterfall). The chosen one is D: A's tables, with B's grouping of traces by root span name.

**Runs screen: one flat table, newest first.**

- Columns: marks, service, started, duration, traces, failed, spans, logs, run id (dim).
- A run reads as service plus start time: `order-api · 14:03:27` today, `yest 14:03` yesterday, `Tue 14:03`
  before that. An empty service shows `(unnamed)`. The breadcrumb uses the same label.
- `failed` counts traces whose root failed; when only recovered spans failed it shows their count in
  parentheses, dim: `(6)`.
- No grouping by service: the question while working is "what just ran", and the service is a column.
  Narrowing to one service belongs to "Search and filter".
- `S` cycles the sort (newest first, service, failures, duration) and `r` reverses it.

**Traces screen: A's columns, grouped by root span name from 20.**

- Columns: marks, root span (the earliest span's name for a partial trace), started as an offset from the
  run's start, duration, spans, failed spans, logs, error.
- The error is the first exception written in the trace: children are written before parents, so it is where
  the failure started. Shown as `Type: message`, bright when the root failed, dim when it recovered.
- A root span name with **20 or more traces** folds under a heading row, the threshold the trace view uses for
  same-name siblings; smaller names stay flat rows. The heading uses the same columns: `▸ POST /orders ×3000`,
  the first member's offset, p50 in the duration column, total spans, **failed traces**, total logs, and the
  most common error (`500× PaymentDeclined · 2 other errors`).
- Groups start closed. A closed group shows at most **5** of its failed, interrupted or running members, then a
  row `⋯ 495 more failed · 500 recovered · 2000 ok`. `⏎`/Space on a heading or that row opens or closes it.
- `S` cycles the sort (start, duration, failures, spans) and `r` reverses it. The sort applies inside a group,
  and a group sits where its best member would.

**Marks.**

| Mark       | Run                                                    | Trace                                      |
| ---------- | ------------------------------------------------------ | ------------------------------------------ |
| `●` green  | live: a record arrived in the last 5 s while following |                                            |
| `✗` bright | a trace's root failed                                  | the root failed                            |
| `✗` dim    | spans failed, every root succeeded                     | spans failed, the root succeeded           |
| `⊘` amber  | interrupted spans                                      | the root was interrupted                   |
| `▸` accent |                                                        | running: live and no root yet              |
| `?` muted  |                                                        | partial: no root and not live; `(partial)` |

The format has no end-of-run marker, so live is a 5-second window, and only while following. A live run's
duration and a running trace's duration end in `…` and grow.

**Problems and `n`/`N`.** On both list screens `n`/`N` stop only where a root failed or was interrupted: runs
with a failed trace, and traces whose root failed or was interrupted. Recovered traces keep the dim mark but are
not stops. Landing on a closed group's "more" row with hidden problems opens the group on the first (or, with
`N`, the last) hidden one. The trace view's own `n`/`N` rule is unchanged.

**Live data.** Selection is by id, as "Route tree and URL state" settled. While nothing has been selected, the
first row shows as selected, so on the newest-first runs list a new live run takes the highlight; once the user
moves, the cursor stays on its run as rows arrive. Whether that becomes an explicit follow mode is for
"Live-tail UX".

**One run.** A file holding exactly one run when the first snapshot is published opens on `[Runs, Traces R]`;
`Esc` still reaches `Runs`.

**Keys** (both list screens): `j`/`k`/`↑`/`↓` move · `g`/`G` ends · `Ctrl-d`/`Ctrl-u` half page · `⏎` open,
or fold a group · Space fold a group · `n`/`N` next/previous problem · `S` sort · `r` reverse · `Esc` back
(nothing on `Runs`) · `q` quit. Search (`/`) belongs to "Search and filter".

**View state** in the typed stack, extending "Route tree and URL state":

| Screen   | `view`                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Runs`   | `selected: Option<RunId>`, `filter: string`, `sort: "newest" \| "service" \| "failures" \| "duration"`, `reverse: boolean`                                                 |
| `Traces` | `selected: Option<TraceId>`, `filter: string`, `sort: "start" \| "duration" \| "failures" \| "spans"`, `reverse: boolean`, `openGroups: HashSet<string>` (root span names) |

**Aggregates the store keeps**, extending "Data layer: tailing, indexing and exposing the file to React", so the
lists never walk spans: per run, failed traces (root failed), failed and interrupted spans, logs and the time of
the last record; per trace, failed and interrupted spans, logs, the root's exit, the first exception's type and
message, and the time of the last record. Group headings (p50, most common error) are derived per render from
the group's traces.
