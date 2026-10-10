import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { Action } from "../../src/keys/Action.ts";
import { indexer } from "../../src/model/list.ts";
import { follow, ListOutcome, select, stepList } from "../../src/nav/ListStep.ts";

import type { List } from "../../src/model/list.ts";

const rows = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }];
const list: List<{ readonly key: string }, string> = {
    rows,
    selectionOf: (row) => row.key,
    keyOf: (value) => value,
    indexOf: indexer(rows),
    stops: [1, 3],
    followIndex: 4,
    timeSort: true,
    newestEnd: "end",
    starts: [1, 2, 3, 4, 5],
    filter: "",
    query: [],
    matched: 5,
    total: 5,
};

const move = (by: "row" | "halfPage" | "page", dir: "next" | "prev") => Action.Move({ by, dir });

describe("stepList", () => {
    it("moves by rows and pages, clamped, and stays at an end", () => {
        expect(stepList(list, 1, move("row", "next"), 10)).toEqual(ListOutcome.Select({ index: 2 }));
        expect(stepList(list, 1, move("halfPage", "next"), 4)).toEqual(ListOutcome.Select({ index: 3 }));
        expect(stepList(list, 1, move("page", "next"), 10)).toEqual(ListOutcome.Select({ index: 4 }));
        expect(stepList(list, 4, move("row", "next"), 10), "the following row stays following").toEqual(
            ListOutcome.Stay(),
        );
        expect(stepList(list, 0, move("page", "prev"), 10)).toEqual(ListOutcome.Stay());
    });

    it("follows on the jump to the newest end, and selects on the other", () => {
        expect(stepList(list, 1, Action.Jump({ to: "end" }), 10)).toEqual(ListOutcome.Follow());
        expect(stepList(list, 3, Action.Jump({ to: "start" }), 10)).toEqual(ListOutcome.Select({ index: 0 }));
        expect(stepList({ ...list, newestEnd: "start" }, 3, Action.Jump({ to: "start" }), 10)).toEqual(
            ListOutcome.Follow(),
        );
        expect(stepList({ ...list, timeSort: false }, 1, Action.Jump({ to: "end" }), 10)).toEqual(
            ListOutcome.Select({ index: 4 }),
        );
    });

    it("lands on the next and previous problem, wrapping, and says when there is none", () => {
        const problem = (current: number, dir: "next" | "prev") =>
            stepList(list, current, Action.NextProblem({ dir }), 10);
        expect(problem(0, "next")).toEqual(ListOutcome.Land({ index: 1, dir: "next" }));
        expect(problem(1, "next")).toEqual(ListOutcome.Land({ index: 3, dir: "next" }));
        expect(problem(3, "next")).toEqual(ListOutcome.Land({ index: 1, dir: "next" }));
        expect(problem(3, "prev")).toEqual(ListOutcome.Land({ index: 1, dir: "prev" }));
        expect(problem(2, "prev")).toEqual(ListOutcome.Land({ index: 1, dir: "prev" }));
        expect(problem(1, "prev")).toEqual(ListOutcome.Land({ index: 3, dir: "prev" }));
        expect(stepList({ ...list, stops: [] }, 0, Action.NextProblem({ dir: "next" }), 10)).toEqual(
            ListOutcome.Say({ text: "no problems" }),
        );
    });

    it("selects a clicked row, opens the selected one, and ignores an unknown key", () => {
        expect(stepList(list, 1, Action.Pick({ key: "c" }), 10)).toEqual(ListOutcome.Select({ index: 2 }));
        expect(stepList(list, 2, Action.Pick({ key: "c" }), 10)).toEqual(ListOutcome.Activate({ index: 2 }));
        expect(stepList(list, 2, Action.Pick({ key: "zz" }), 10)).toEqual(ListOutcome.Stay());
        expect(stepList(list, 2, Action.Open(), 10)).toEqual(ListOutcome.Activate({ index: 2 }));
    });
});

describe("select and follow", () => {
    const following = { selected: Option.none<string>(), newerThan: Option.none<number>() };

    it("sets newerThan on the move from no selection, whatever the sort, and later moves keep it", () => {
        const first = select(list, following, "b");
        expect(first).toEqual({ selected: Option.some("b"), newerThan: Option.some(5) });
        expect(select({ ...list, starts: [1, 9] }, first, "c").newerThan).toEqual(Option.some(5));
        expect(select({ ...list, timeSort: false }, following, "b").newerThan, "for a later time sort").toEqual(
            Option.some(5),
        );
        expect(select(list, first, "b"), "the same view when nothing changes").toBe(first);
    });

    it("clears the selection and newerThan to follow again", () => {
        expect(follow({ selected: Option.some("b"), newerThan: Option.some(5) })).toEqual(following);
    });
});
