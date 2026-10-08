---
id: "20"
title: CLI surface and npm packaging
labels: [wayfinder:grilling]
status: open
assignee:
blocked_by: [15, 18]
---

## Question

What does the published command look like? The runtime, bin shim and build are settled in "Runtime and Node
version policy for packages/tui". Decide:

- the npm package name and the bin name;
- arguments and flags: the file, a run filter, `--no-follow`, `--last-runs`, `--run`/`--trace` to seed the
  screen stack, `--version`, `--help`;
- what happens with no file, a missing file, or a file of 0.2.x records;
- exit codes and what is printed on exit;
- the README that becomes the npm page.
