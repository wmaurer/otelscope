import { Array as Arr, HashSet, Option } from "effect";

import { TreeRow } from "../nav/Screen.ts";
import { spanMatches } from "../query/Match.ts";
import { factsOf } from "./treeFacts.ts";

import type { SpanId, Trace } from "../data/Snapshot.ts";
import type { GroupKey, Opening } from "../nav/Screen.ts";
import type { Query } from "../query/Query.ts";
import type { TreeFacts } from "./treeFacts.ts";

/** The groups to open so `spanId` shows: those holding a span of its lineage that a closed group would not show. */
export const groupsToOpen = (facts: TreeFacts, spanId: SpanId): ReadonlyArray<GroupKey> =>
    Arr.getSomes(
        Arr.map(facts.lineage(spanId), (id) =>
            Option.map(
                Option.filter(facts.groupOf(id), (group) => !group.problems.has(id)),
                (group) => group.key,
            ),
        ),
    );

/**
 * 06's opening selection: the first span matching every term of the seeded search (its groups opened), else the first
 * failure origin, else the first interrupted span, else the root or the first row of a partial trace. None when the
 * tree has no row: every span's parent chain loops.
 */
export const openingFor = (trace: Trace, search: Query): Opening => {
    const facts = factsOf(trace);
    const order = facts.order();
    const matched =
        search.length === 0
            ? Option.none()
            : Arr.findFirst(order.ids, (id) => {
                  const span = trace.spans.get(id);
                  return span !== undefined && spanMatches(search, span);
              });
    if (Option.isSome(matched)) {
        return {
            selected: Option.some(TreeRow.Span({ spanId: matched.value })),
            openGroups: HashSet.fromIterable(groupsToOpen(facts, matched.value)),
        };
    }
    const at = (position: number | undefined) => Option.fromUndefinedOr(order.ids[position ?? -1]);
    const chosen = Option.orElse(
        Option.orElse(at(order.origins[0]), () =>
            Option.flatMap(
                Arr.findFirst(order.problems, (position) => facts.kind(order.ids[position] ?? "") === "interrupted"),
                at,
            ),
        ),
        () => Arr.head(trace.topLevel),
    );
    return {
        selected: Option.orElse(
            Option.map(chosen, (spanId) => TreeRow.Span({ spanId })),
            () => Option.map(Arr.head(trace.missingParents), (parentId) => TreeRow.Missing({ parentId })),
        ),
        openGroups: HashSet.empty(),
    };
};
