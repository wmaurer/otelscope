---
id: "17"
title: Search and filter
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: [15]
---

## Question

What can be searched and filtered, and how? Decide:

- what a query matches: span name, attribute keys and values, exit state, log text, exception type;
- the query syntax (plain substring, `key=value` terms, exit filters such as `failed`);
- where it applies: the run and trace lists, the span tree, the logs pane;
- whether a match filters (hides the rest) or highlights and jumps (`n`/`N` already move between problem
  spans in the tree);
- how the search input takes focus and coexists with single-letter keys;
- whether filters live in each screen's view state, so `Esc` back restores them.
