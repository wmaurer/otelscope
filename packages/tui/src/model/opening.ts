import { Array as Arr, HashSet, Option } from "effect";

import { TreeRow } from "../nav/Screen.ts";
import { spanMatches } from "../query/Match.ts";
import { isPropagated } from "./failure.ts";
import { GROUP_MIN } from "./traceList.ts";

import type { SpanId, Trace } from "../data/Snapshot.ts";
import type { GroupKey } from "../nav/Screen.ts";
import type { Query } from "../query/Query.ts";

/** Where a trace opens, and the same-name groups that must be open for that row to show. Folds start empty. */
export interface Opening {
    readonly selected: TreeRow;
    readonly openGroups: HashSet.HashSet<GroupKey>;
}

export function* treeOrder(trace: Trace): Generator<SpanId> {
    function* below(id: SpanId): Generator<SpanId> {
        yield id;
        for (const child of trace.children.get(id) ?? []) {
            yield* below(child);
        }
    }
    for (const id of trace.topLevel) {
        yield* below(id);
    }
    for (const parent of trace.missingParents) {
        for (const child of trace.children.get(parent) ?? []) {
            yield* below(child);
        }
    }
}

const firstWhere = (trace: Trace, test: (id: SpanId) => boolean): Option.Option<SpanId> => {
    for (const id of treeOrder(trace)) {
        if (test(id)) {
            return Option.some(id);
        }
    }
    return Option.none();
};

const groupKeyOf = (trace: Trace, id: SpanId): Option.Option<GroupKey> => {
    const span = trace.spans.get(id);
    if (span === undefined) {
        return Option.none();
    }
    const siblings = trace.children.get(span.parent) ?? [];
    const named = Arr.reduce(siblings, 0, (n, sibling) => (trace.spans.get(sibling)?.name === span.name ? n + 1 : n));
    const key: GroupKey = `${span.parent ?? ""}|${span.name}`;
    return named >= GROUP_MIN ? Option.some(key) : Option.none();
};

const lineage = (trace: Trace, id: SpanId): ReadonlyArray<SpanId> => {
    const chain: Array<SpanId> = [];
    for (let at: SpanId | null | undefined = id; at != null && trace.spans.has(at); at = trace.spans.get(at)?.parent) {
        chain[chain.length] = at;
    }
    return chain;
};

export const openingFor = (trace: Trace, search: Query): Opening => {
    const exit = (id: SpanId) => trace.spans.get(id)?.exit;
    const matched =
        search.length === 0
            ? Option.none()
            : firstWhere(trace, (id) => {
                  const span = trace.spans.get(id);
                  return span !== undefined && spanMatches(search, span);
              });
    if (Option.isSome(matched)) {
        return {
            selected: TreeRow.Span({ spanId: matched.value }),
            openGroups: HashSet.fromIterable(
                Arr.getSomes(Arr.map(lineage(trace, matched.value), (id) => groupKeyOf(trace, id))),
            ),
        };
    }
    const chosen = Option.orElse(
        Option.orElse(
            firstWhere(trace, (id) => exit(id) === "Failure" && !isPropagated(trace, id)),
            () => firstWhere(trace, (id) => exit(id) === "Interrupted"),
        ),
        () => Arr.head(trace.topLevel),
    );
    return {
        selected: Option.match(chosen, {
            onSome: (spanId) => TreeRow.Span({ spanId }),
            onNone: () =>
                Option.match(Arr.head(trace.missingParents), {
                    onSome: (parentId) => TreeRow.Missing({ parentId }),
                    onNone: () => TreeRow.Span({ spanId: "" }),
                }),
        }),
        openGroups: HashSet.empty(),
    };
};
