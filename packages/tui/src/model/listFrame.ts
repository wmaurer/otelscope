import { Array as Arr, Option } from "effect";

import { basename, count } from "./format.ts";
import { newRowsText, selectedIndex } from "./list.ts";
import { chunk } from "./Role.ts";
import { runLayout, runLine, runSortColumn } from "./runList.ts";
import { header } from "./table.ts";
import { traceLayout, traceLine, traceSortColumn } from "./traceLine.ts";

import type { Snapshot } from "../data/Snapshot.ts";
import type { Screen } from "../nav/Screen.ts";
import type { Keyed, List, ListSelection } from "./list.ts";
import type { Line } from "./Role.ts";
import type { ScreenList } from "./screenList.ts";
import type { Placed } from "./table.ts";

interface ListEnv {
    readonly snapshot: Snapshot;
    readonly now: number;
    readonly file: string;
    readonly width: number;
}

export interface Table {
    readonly _tag: "Table";
    readonly header: Line;
    readonly size: number;
    readonly selected: number;
    readonly keyAt: (index: number) => string;
    readonly line: (index: number, selected: boolean) => Line;
}

export interface Message {
    readonly _tag: "Message";
    readonly lines: ReadonlyArray<Line>;
}

export type ListBody = Table | Message;

export interface ListFrame {
    readonly body: ListBody;
    readonly query: Option.Option<string>;
    readonly newRows: Option.Option<string>;
    readonly count: string;
}

const message = (...texts: ReadonlyArray<string>): Message => ({
    _tag: "Message",
    lines: Arr.map(texts, (text, i) => [chunk(text, i === 0 ? "text" : "muted")]),
});

const noMatch = (noun: string, filter: string): Message =>
    message(`No ${noun} match "${filter}".`, "Esc clears the filter");

const runsEmpty = (env: ListEnv): Option.Option<Message> => {
    const { status, badLines, runs } = env.snapshot;
    if (status.phase === "waiting") {
        return Option.some(message(`Waiting for ${env.file}…`));
    }
    if (runs.size > 0) {
        return Option.none();
    }
    if (status.phase === "loading") {
        return Option.some(message("Loading…"));
    }
    if (badLines.legacy > 0) {
        return Option.some(
            message(
                `This file was written by @wmaurer/otelscope-effect < 0.3 (${count(badLines.legacy)} lines). Rerun your program with >= 0.3.`,
            ),
        );
    }
    const name = basename(env.file);
    return Option.some(message(status.phase === "done" ? `No spans in ${name}.` : `No spans in ${name} yet.`));
};

interface ListKind<Row, Id extends string> {
    readonly noun: string;
    readonly placed: ReadonlyArray<Placed<Id>>;
    readonly sorted: Id;
    /** Wins over the rows and over the no-match message. */
    readonly empty: Option.Option<Message>;
    readonly line: (row: Row, selected: boolean) => Line;
}

const tableFrame = <Row extends Keyed, K, Id extends string>(
    list: List<Row, K>,
    view: ListSelection<K> & { readonly filter: string; readonly reverse: boolean },
    width: number,
    kind: ListKind<Row, Id>,
): ListFrame => ({
    body: Option.getOrElse(
        Option.orElse(kind.empty, () =>
            list.matched === 0 && list.filter !== "" ? Option.some(noMatch(kind.noun, list.filter)) : Option.none(),
        ),
        (): ListBody => ({
            _tag: "Table",
            header: header(kind.placed, kind.sorted, view.reverse, width),
            size: list.rows.length,
            selected: selectedIndex(list, view),
            keyAt: (i) => list.rows[i]?.key ?? "",
            line: (i, isSelected) => {
                const row = list.rows[i];
                return row === undefined ? [] : kind.line(row, isSelected);
            },
        }),
    ),
    query:
        view.filter === ""
            ? Option.none()
            : Option.some(`/ ${view.filter} · ${count(list.matched)} of ${count(list.total)}`),
    newRows: newRowsText(list, view),
    count: `${count(list.matched)} of ${count(list.total)} ${kind.noun}`,
});

export const listFrame = (screen: Screen, built: ScreenList, env: ListEnv): Option.Option<ListFrame> => {
    if (screen._tag === "Runs" && built._tag === "Runs") {
        const { list } = built;
        const placed = runLayout(env.width);
        const context = { placed, phase: env.snapshot.status.phase, now: env.now, query: list.query, width: env.width };
        return Option.some(
            tableFrame(list, screen.view, env.width, {
                noun: "runs",
                placed,
                sorted: runSortColumn[screen.view.sort],
                empty: runsEmpty(env),
                line: (row, selected) => runLine(row.run, context, selected),
            }),
        );
    }
    if (screen._tag === "Traces" && built._tag === "Traces") {
        const { list } = built;
        const placed = traceLayout(env.width);
        const context = { placed, run: list.run, query: list.query, filtered: list.query.length > 0, width: env.width };
        return Option.some(
            tableFrame(list, screen.view, env.width, {
                noun: "traces",
                placed,
                sorted: traceSortColumn[screen.view.sort],
                empty: Option.none(),
                line: (row, selected) => traceLine(row, context, selected),
            }),
        );
    }
    return Option.none();
};
