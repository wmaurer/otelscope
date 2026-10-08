---
id: "16"
title: Body viewer
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: []
---

## Question

How does the `Body` screen work? The details pane lists bodies one row per prefix with size and preview. Decide:

- the key that opens the selected body, and how a body is selected in the details pane;
- how the body is rendered: plain text, JSON pretty-printed, syntax highlighting, line wrapping;
- what happens when the body file is missing or larger than is sensible to load;
- whether a key hands the body to `$PAGER` or `$EDITOR`, as `e` already does for source locations;
- the screen's keys (scroll, search within the body, back).
