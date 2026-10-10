import { describe, expect, it } from "@effect/vitest";
import { Array as Arr } from "effect";

import { runList } from "../../src/model/runList.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { RunsView } from "../../src/nav/Screen.ts";

const snapshot = indexed([
    record({ span: "a", run: "r1", trace: "t1", service: "shop-api", startMs: 1000, ms: 50 }),
    record({ span: "b", run: "r2", trace: "t2", service: "billing", startMs: 2000, ms: 500, exit: "Failure" }),
    record({ span: "c", run: "r3", trace: "t3", service: "shop-api", startMs: 3000, ms: 5 }),
    record({ span: "d", run: "r3", trace: "t3", parent: "c", startMs: 3001, exit: "Failure" }),
    record({ span: "e", run: "r4", trace: "t4", service: "agent", startMs: 4000, ms: 5 }),
]);

const view = (over: Partial<RunsView> = {}): Pick<RunsView, "sort" | "reverse"> => ({
    sort: "newest",
    reverse: false,
    ...over,
});
const order = (v: Pick<RunsView, "sort" | "reverse">, filter = "") =>
    Arr.map(runList(snapshot, v, filter).rows, (row) => row.key);

describe("runList", () => {
    it("lists newest first, and the other sorts break ties on newest", () => {
        expect(order(view())).toEqual(["r4", "r3", "r2", "r1"]);
        expect(order(view({ sort: "service" }))).toEqual(["r4", "r2", "r3", "r1"]);
        expect(order(view({ sort: "failures" })), "failed traces, then failed spans").toEqual(["r2", "r3", "r4", "r1"]);
        expect(order(view({ sort: "duration" }))).toEqual(["r2", "r1", "r4", "r3"]);
    });

    it("reverses any sort", () => {
        expect(order(view({ reverse: true }))).toEqual(["r1", "r2", "r3", "r4"]);
        expect(order(view({ sort: "failures", reverse: true }))).toEqual(["r1", "r4", "r3", "r2"]);
    });

    it("filters by run id or the run's own spans, and counts matched of total", () => {
        expect(order(view(), "shop")).toEqual(["r3", "r1"]);
        expect(order(view(), "r2")).toEqual(["r2"]);
        const list = runList(snapshot, view(), "shop");
        expect([list.matched, list.total]).toEqual([2, 4]);
    });

    it("follows the newest row at the top, or the bottom when reversed, and only under newest", () => {
        expect(runList(snapshot, view(), "").followIndex).toBe(0);
        expect(runList(snapshot, view({ reverse: true }), "").followIndex).toBe(3);
        expect(runList(snapshot, view({ sort: "service" }), "").timeSort).toBe(false);
        expect(runList(snapshot, view({ reverse: true }), "").newestEnd).toBe("end");
    });

    it("stops only at runs with a failed trace, and keeps starts ascending", () => {
        const list = runList(snapshot, view(), "");
        expect(Arr.map(list.stops, (i) => list.rows[i]?.key)).toEqual(["r2"]);
        expect(list.starts).toEqual([1000, 2000, 3000, 4000]);
    });
});
