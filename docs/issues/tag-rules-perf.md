# perf(tui): the tag-rule refactor slows live publish on the Traces screen past its budget

## Summary

Commit f5b9171 (`refactor(tui): turn the tag rules on for the viewer`) made the viewer's tail latencies 10–50% higher on several hot paths. The live publish on the Traces screen now misses its 16 ms p95 budget in about half of the perf runs, so `main` fails the viewer's release perf check on the development machine about half the time.

The 0.1.3 release commit (630e39b) is older than f5b9171, but a publish from `main` includes f5b9171.

## Impact

- **Users:** while the program is still writing spans, the Traces screen occasionally takes longer than a frame to show new ones. Trees with large groups take longer to fold and unfold.
- **Release:** `pnpm --filter @wmaurer/otelscope perf` must pass before `@wmaurer/otelscope` is published (`docs/specs/span-viewer/12-performance.md`). At f5b9171 it fails intermittently.

## Evidence

Comparison of f5b9171 with its parent, 37a2dfc:

- All runs were in the same checkout, one after the other, alternating between the two commits.
- 37a2dfc and f5b9171 differ only in viewer source, the oxlint config, and one tag check in the perf harness. That tag check runs once per list update.
- There were two full-suite runs per commit (ABAB), then four `--only idle,following` runs per commit (ABBA ABBA).
- Machine: Node 26.12.0 on Linux, load average about 3.

### Metrics whose p95 ranges do not overlap

| Metric                                            | 37a2dfc p95 range | f5b9171 p95 range |
| ------------------------------------------------- | ----------------- | ----------------- |
| live publish: on the Traces screen (budget 16 ms) | 10.8–11.7 ms      | 12.6–20.6 ms      |
| live publish: freeze + re-render, all screens     | 9.6–10.2 ms       | 11.1–15.9 ms      |
| live publish: freeze to the snapshot's listeners  | 5.7–6.2 ms        | 6.3–11.4 ms       |
| key press idle: trace fold/unfold the root        | 11.4–11.7 ms      | 12.7–15.9 ms      |
| key press idle: trace close/open the group        | 11.5–12.6 ms      | 12.7–15.9 ms      |

### Budget failures over six runs per commit

- **f5b9171:** "live publish: on the Traces screen" failed in 3 runs, at 16.5, 17.6 and 20.6 ms.
- **37a2dfc:** that metric never failed. The parent had one other failure, "key press idle: traces PgDn" at 16.9 ms, which also happened before this change.

### Unchanged

Startup, full index, memory, all three searches, every j/k and PgDn key press, and the live publish on the Trace screen are within run-to-run noise.

## Suspected cause

This is an inference from microbenchmarks and the shape of the regression. It has not been profiled.

The medians barely moved while the tails grew, which suggests more allocation and garbage collection rather than slower logic. Single-call timings, measured on Node 26.12 with effect 4.1.0:

| Pattern the tag rules require                            | Effect  | Native | Ratio |
| -------------------------------------------------------- | ------- | ------ | ----- |
| `Data.taggedEnum` constructor vs `{ _tag: ... }` literal | 25.9 ns | 3.9 ns | 6.6×  |
| data-first `Enum.$match(x, {...})` vs `switch`           | 27.9 ns | 4.8 ns | 5.8×  |
| `Predicate.isTagged` / `$is` vs `_tag ===`               | 10.5 ns | 4.8 ns | 2.2×  |
| curried `$match`, created once, vs `switch`              | 10.8 ns | 5.0 ns | 2.2×  |

A `taggedEnum` constructor is a Proxy lookup plus an object spread, so it allocates two objects where a literal allocated one. The regressed metrics are the ones that build a tagged value per row or per span on every update:

- `src/model/traceList.ts`: the Traces list rows (`TraceListRow`, `traceRow`, `headingRow`, `moreRow`) and `rowKey` and `rowValue`.
- `src/model/tree.ts` and `src/model/treeFacts.ts`: `Sibling.One` for every shown group member, in `pushAll(Arr.map(shown, one), ...)`, and `Sibling` items in `siblingList`.
- `src/model/treeLine.ts` and `src/model/traceFrame.ts`: the per-row line and bar decisions.
- `src/data/Index.ts`, `src/data/SpanStore.ts` and `src/data/SpanSource.ts`: the publish path (`TailEvent.$match`, `Tail` constructors, the ingest `$is` chain). This matches the change in "freeze to the snapshot's listeners".

The array rules (`effect-native/native-array-method`, `native-array-mutation`, `imperative-collection-build`) are not involved. They have been on since the scaffold commit 8d633f2. In the same microbenchmarks their Effect forms run within 10% of native, or faster.

## Proposed fix

1. Profile a live publish on the Traces screen at both commits, using a CPU profile and an allocation profile. That shows which call sites carry the cost.
2. Fix only those call sites, in this order of preference:
    - Use `Data.tagged` constructors, or another constructor without the Proxy. Time it first.
    - Go back to a plain `{ _tag }` literal or `_tag` check, with a line-level `oxlint-disable-next-line` and the reason. `oxlint.config.ts` already recommends this over turning a rule off.
3. Rerun the A/B comparison below. Done when the five metrics above overlap the 37a2dfc ranges again, and the full suite passes in six runs out of six.

## How to reproduce

Run from the repository root with a clean working tree. Alternate the commits, so drift on the machine affects both commits the same way:

```sh
for c in 37a2dfc f5b9171 f5b9171 37a2dfc 37a2dfc f5b9171 f5b9171 37a2dfc; do
  git checkout -q --detach "$c"
  echo "== $c"
  pnpm --filter @wmaurer/otelscope perf --only idle,following 2>&1 | grep -E 'live publish|fold/unfold|close/open|FAIL'
done
git checkout -q main
```

Compare runs only when they come from the same checkout. Earlier comparisons showed that identical code runs at different speeds from different worktrees or installs.
