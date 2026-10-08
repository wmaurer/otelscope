---
id: "15"
title: Run and trace list screens
labels: [wayfinder:prototype]
status: open
assignee:
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
