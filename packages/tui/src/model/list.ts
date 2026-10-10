import { Option } from "effect";

import type { Query } from "../query/Query.ts";

export interface Keyed {
    readonly key: string;
}

export interface List<Row extends Keyed, K> {
    readonly rows: ReadonlyArray<Row>;
    readonly selectionOf: (row: Row) => K;
    readonly keyOf: (value: K) => string;
    readonly indexOf: (key: string) => number;
    readonly stops: ReadonlyArray<number>;
    readonly followIndex: number;
    readonly timeSort: boolean;
    readonly newestEnd: "start" | "end";
    readonly starts: ReadonlyArray<number>;
    readonly filter: string;
    readonly query: Query;
    readonly matched: number;
    readonly total: number;
}

export interface ListSelection<K> {
    readonly selected: Option.Option<K>;
    readonly newerThan: Option.Option<number>;
}

export const indexer = (rows: ReadonlyArray<Keyed>): ((key: string) => number) => {
    let lastKey: string | undefined;
    let lastIndex = -1;
    return (key) => {
        if (key !== lastKey) {
            lastKey = key;
            lastIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i]?.key === key) {
                    lastIndex = i;
                    break;
                }
            }
        }
        return lastIndex;
    };
};

export const isFollowing = <Row extends Keyed, K>(list: List<Row, K>, selection: ListSelection<K>): boolean =>
    list.timeSort && Option.isNone(selection.selected);

export const selectedIndex = <Row extends Keyed, K>(list: List<Row, K>, selection: ListSelection<K>): number => {
    if (list.rows.length === 0) {
        return -1;
    }
    return Option.match(selection.selected, {
        onNone: () => (list.timeSort ? list.followIndex : 0),
        onSome: (value) => Math.max(0, list.indexOf(list.keyOf(value))),
    });
};

export const newestStart = <Row extends Keyed, K>(list: List<Row, K>): Option.Option<number> =>
    list.starts.length === 0 ? Option.none() : Option.some(list.starts[list.starts.length - 1] ?? 0);

const countAfter = (starts: ReadonlyArray<number>, after: number): number => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if ((starts[mid] ?? 0) <= after) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return starts.length - low;
};

export const newRowCount = <Row extends Keyed, K>(list: List<Row, K>, selection: ListSelection<K>): number =>
    list.timeSort && Option.isSome(selection.selected)
        ? Option.match(selection.newerThan, { onNone: () => 0, onSome: (after) => countAfter(list.starts, after) })
        : 0;

export const newRowsText = <Row extends Keyed, K>(
    list: List<Row, K>,
    selection: ListSelection<K>,
): Option.Option<string> => {
    const n = newRowCount(list, selection);
    return n === 0 ? Option.none() : Option.some(`${list.newestEnd === "start" ? "↑" : "↓"} ${n} new`);
};
