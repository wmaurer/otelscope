import { Option } from "effect";

import { logList } from "./logs.ts";
import { rowKey, rowOf, shownIndex } from "./tree.ts";

import type { LogScope, TraceView, TreeRow } from "../nav/Screen.ts";
import type { LogList } from "./logs.ts";
import type { Tree, TreeEntry } from "./tree.ts";
import type { TreeFacts } from "./treeFacts.ts";
import type { SpanSearch } from "./treeSearch.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

/** Everything the Trace screen's keys and frame read, derived from the trace and the view. */
export interface TraceModel {
    readonly facts: TreeFacts;
    readonly tree: Tree;
    readonly search: SpanSearch;
    /** The row the selection shows as (`shownIndex`), -1 for an empty tree. */
    readonly index: number;
    readonly entry: Option.Option<TreeEntry>;
    readonly logs: LogList;
}

/** The record of the span the selection shows as; None on a group or missing-parent row. */
export const shownSpan = (model: TraceModel): Option.Option<JsonlSpanRecord> =>
    Option.flatMap(model.entry, (entry) =>
        entry._tag === "Span" ? Option.fromUndefinedOr(model.facts.trace.spans.get(entry.spanId)) : Option.none(),
    );

export interface Chosen {
    readonly index: number;
    readonly entry: Option.Option<TreeEntry>;
}

export const chosenOf = (facts: TreeFacts, tree: Tree, view: TraceView): Chosen => {
    const index = shownIndex(tree, facts, view.selected);
    return { index, entry: Option.fromUndefinedOr(tree.rows[index]) };
};

/** What the logs depend on besides the trace. Compared structurally, so a tree move under `trace` scope rebuilds nothing. */
export interface LogsKey {
    readonly scope: LogScope;
    /** The shown row the scope is taken from; None under `trace` scope. */
    readonly anchor: Option.Option<TreeRow>;
    /** The settled log filter. */
    readonly filter: string;
}

export const logsKeyOf = (view: TraceView, entry: Option.Option<TreeEntry>, filter: string): LogsKey => ({
    scope: view.logScope,
    anchor: view.logScope === "trace" ? Option.none() : Option.map(entry, rowOf),
    filter,
});

export const logsOfKey = (facts: TreeFacts, tree: Tree, key: LogsKey): LogList =>
    logList(
        facts,
        Option.flatMap(key.anchor, (row) => Option.fromUndefinedOr(tree.rows[tree.indexOf(rowKey(row))])),
        key.scope,
        key.filter,
    );
