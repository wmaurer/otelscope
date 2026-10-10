import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { listFrame } from "../../src/model/listFrame.ts";
import { lineText } from "../../src/model/text.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultRunsView, tracesFor } from "../../src/nav/Screen.ts";
import { listFor } from "../support/lists.ts";
import { record } from "../support/records.ts";
import { indexed, status } from "../support/store.ts";

import type { Snapshot, Status } from "../../src/data/Snapshot.ts";
import type { ListFrame } from "../../src/model/listFrame.ts";

const file = "/home/me/spans.jsonl";
const now = 100_000;
const two = indexed([
    record({ span: "a", run: "r1", trace: "t1", service: "shop-api", startMs: 1000 }),
    record({ span: "b", run: "r2", trace: "t2", service: "billing", startMs: 2000 }),
]);
const empty = indexed([]);

const with_ = (snapshot: Snapshot, over: Partial<Status>, legacy = 0): Snapshot => ({
    ...snapshot,
    status: { ...status, ...over },
    badLines: { ...snapshot.badLines, legacy },
});

const frame = (nav: Nav.Nav, snapshot: Snapshot): ListFrame =>
    Option.getOrThrow(listFrame(Nav.top(nav), listFor(nav, snapshot, now), { snapshot, now, file, width: 120 }));

const runs = (filter = "") => Nav.update(Nav.initial, "Runs", (view) => ({ ...view, filter }));

const messageOf = (f: ListFrame) => (f.body._tag === "Message" ? Arr.map(f.body.lines, lineText) : []);

describe("listFrame", () => {
    it("replaces the Runs table with what the file is doing when there is nothing to list", () => {
        expect(messageOf(frame(runs(), with_(empty, { phase: "waiting" })))).toEqual([`Waiting for ${file}…`]);
        expect(messageOf(frame(runs(), with_(empty, { phase: "loading" })))).toEqual(["Loading…"]);
        expect(messageOf(frame(runs(), with_(empty, { phase: "done" }, 120)))).toEqual([
            "This file was written by @wmaurer/otelscope-effect < 0.3 (120 lines). Rerun your program with >= 0.3.",
        ]);
        expect(messageOf(frame(runs(), with_(empty, { phase: "following" })))).toEqual([
            "No spans in spans.jsonl yet.",
        ]);
        expect(messageOf(frame(runs(), with_(empty, { phase: "done" })))).toEqual(["No spans in spans.jsonl."]);
        expect(frame(runs(), with_(two, { phase: "loading" })).body._tag, "rows already read show").toBe("Table");
    });

    it("says what matched nothing and how to clear it", () => {
        expect(messageOf(frame(runs("zzz"), two))).toEqual(['No runs match "zzz".', "Esc clears the filter"]);
        const traces = Nav.push(Nav.initial, tracesFor("r1", { ...defaultRunsView, filter: "zzz" }));
        expect(messageOf(frame(traces, two))).toEqual(['No traces match "zzz".', "Esc clears the filter"]);
    });

    it("says what the file is doing before saying a filter matched nothing", () => {
        expect(messageOf(frame(runs("shop"), with_(empty, { phase: "waiting" })))).toEqual([`Waiting for ${file}…`]);
        expect(messageOf(frame(runs("shop"), with_(empty, { phase: "loading" })))).toEqual(["Loading…"]);
    });

    it("shows the active query with its count, and the input's count", () => {
        const filtered = frame(runs("shop"), two);
        expect(filtered.query).toEqual(Option.some("/ shop · 1 of 2"));
        expect(filtered.count).toBe("1 of 2 runs");
        expect(frame(runs(), two).query).toEqual(Option.none());
    });

    it("counts new rows once following stopped", () => {
        const stopped = Nav.update(Nav.initial, "Runs", (view) => ({
            ...view,
            selected: Option.some("r1"),
            newerThan: Option.some(1000),
        }));
        expect(frame(stopped, two).newRows).toEqual(Option.some("↑ 1 new"));
    });
});
