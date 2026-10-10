import { Data, Option } from "effect";

import { moveRows } from "../keys/Action.ts";
import { newestStart } from "../model/list.ts";

import type { Dir, ListAction } from "../keys/Action.ts";
import type { Keyed, List, ListSelection } from "../model/list.ts";

export type ListOutcome = Data.TaggedEnum<{
    Select: { readonly index: number };
    Follow: {};
    Activate: { readonly index: number };
    Land: { readonly index: number; readonly dir: Dir };
    Say: { readonly text: string };
    Stay: {};
}>;
export const ListOutcome = Data.taggedEnum<ListOutcome>();

export type Movement = Extract<ListAction, { readonly _tag: "Move" | "Jump" | "NextProblem" | "Pick" | "Open" }>;

const nextStop = (stops: ReadonlyArray<number>, current: number, dir: Dir): number => {
    let low = 0;
    let high = stops.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if ((stops[mid] ?? 0) <= current) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    if (dir === "next") {
        return stops[low] ?? stops[0] ?? -1;
    }
    const before = (stops[low - 1] ?? -1) === current ? low - 2 : low - 1;
    return stops[before] ?? stops[stops.length - 1] ?? -1;
};

export const stepList = <Row extends Keyed, K>(
    list: List<Row, K>,
    current: number,
    action: Movement,
    pageRows: number,
): ListOutcome => {
    const size = list.rows.length;
    switch (action._tag) {
        case "Move": {
            if (size === 0) {
                return ListOutcome.Stay();
            }
            const by = moveRows(action.by, pageRows);
            const target = Math.min(size - 1, Math.max(0, current + (action.dir === "next" ? by : -by)));
            return target === current ? ListOutcome.Stay() : ListOutcome.Select({ index: target });
        }
        case "Jump":
            if (size === 0) {
                return ListOutcome.Stay();
            }
            if (list.timeSort && action.to === list.newestEnd) {
                return ListOutcome.Follow();
            }
            return ListOutcome.Select({ index: action.to === "start" ? 0 : size - 1 });
        case "NextProblem":
            return list.stops.length === 0
                ? ListOutcome.Say({ text: "no problems" })
                : ListOutcome.Land({ index: nextStop(list.stops, current, action.dir), dir: action.dir });
        case "Pick": {
            const index = list.indexOf(action.key);
            if (index < 0) {
                return ListOutcome.Stay();
            }
            return index === current ? ListOutcome.Activate({ index }) : ListOutcome.Select({ index });
        }
        case "Open":
            return current < 0 ? ListOutcome.Stay() : ListOutcome.Activate({ index: current });
    }
};

export const select = <Row extends Keyed, K, V extends ListSelection<K>>(list: List<Row, K>, view: V, value: K): V => {
    if (Option.exists(view.selected, (stored) => list.keyOf(stored) === list.keyOf(value))) {
        return view;
    }
    return {
        ...view,
        selected: Option.some(value),
        newerThan: Option.isNone(view.selected) ? newestStart(list) : view.newerThan,
    };
};

export const follow = <K, V extends ListSelection<K>>(view: V): V =>
    Option.isNone(view.selected) && Option.isNone(view.newerThan)
        ? view
        : { ...view, selected: Option.none(), newerThan: Option.none() };
