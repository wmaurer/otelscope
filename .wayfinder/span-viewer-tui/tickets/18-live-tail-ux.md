---
id: "18"
title: Live-tail UX
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: [15]
---

## Question

How does the TUI behave while the file grows? Storage and marking of partial traces are settled in "Data
layer: tailing, indexing and exposing the file to React". Decide:

- whether there is a follow mode that keeps the newest run or trace selected, how it is turned on and off,
  and what turns it off (moving the selection by hand?);
- how new data is signalled on screens that do not show it (a counter, a status bar marker);
- what the trace view does when an open trace gains spans: keep the selection and folds, extend the axis;
- what the status bar shows about the file (following, lines read, bad lines, file truncated or replaced).
