import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Layer, Option, SubscriptionRef } from "effect";

import { SpanStore } from "../../src/data/SpanStore.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { initialNav } from "../../src/nav/Seed.ts";
import { mount } from "../support/app.tsx";
import { tempDir } from "../support/files.ts";
import { record } from "../support/records.ts";
import { indexed } from "../support/store.ts";

import type { Snapshot } from "../../src/data/Snapshot.ts";

const width = 100;
const height = 20;

const twoRuns = indexed([record({ span: "a", run: "run-1" }), record({ span: "b", run: "run-2" })]);

const serviceRecords = [
    record({ span: "a", run: "run-1", trace: "t1", service: "shop-api", startMs: 1000 }),
    record({ span: "b", run: "run-2", trace: "t2", service: "billing", startMs: 2000 }),
    record({ span: "c", run: "run-3", trace: "t3", service: "agent", startMs: 3000 }),
];
const services = indexed(serviceRecords);

/** `bodies` are written to `bodies/<sha256>.txt` next to the file. */
const start = async (
    nav: Nav.Nav = Nav.initial,
    first: Snapshot = twoRuns,
    bodies: Readonly<Record<string, string>> = {},
) => {
    const dir = tempDir();
    mkdirSync(join(dir, "bodies"));
    for (const [sha256, text] of Object.entries(bodies)) {
        writeFileSync(join(dir, "bodies", `${sha256}.txt`), text);
    }
    const ref = Effect.runSync(SubscriptionRef.make(first));
    const app = await mount({
        file: join(dir, "spans.jsonl"),
        follow: true,
        store: Layer.succeed(SpanStore, SpanStore.of({ snapshot: ref })),
        nav,
        width,
        height,
    });
    return { ...app, publish: (next: Snapshot) => app.after(SubscriptionRef.set(ref, next)) };
};

const lineIndex = (frame: string, text: string): number =>
    Option.getOrElse(
        Arr.findFirstIndex(frame.split("\n"), (row) => row.includes(text)),
        () => -1,
    );

const line = (frame: string, index: number) => frame.split("\n")[index]?.trimEnd() ?? "";

describe("App", () => {
    it("quits on q and Ctrl-c, and on nothing else", async () => {
        const app = await start();
        try {
            await app.press("x");
            expect(app.quits()).toBe(0);
            await app.press("q");
            expect(app.quits()).toBe(1);
            await app.press("c", { ctrl: true });
            expect(app.quits()).toBe(2);
            await app.press("z", { ctrl: true });
            expect(app.suspends()).toBe(1);
        } finally {
            await app.stop();
        }
    });

    it("opens help on ?, scrolls it, and closes it on q without quitting", async () => {
        const app = await start();
        try {
            const open = await app.press("?");
            expect(open).toContain("Help · Runs");
            expect(line(open, height - 1)).toMatch(/^Esc close/);
            expect(open).toMatch(/│ Runs +│/);
            expect(open).not.toContain("Mouse:");
            expect(await app.press("j"), "one row down").not.toMatch(/│ Runs +│/);
            expect(await app.press("G"), "to the end").toContain("Mouse:");
            const closed = await app.press("q");
            expect(closed).not.toContain("Help · Runs");
            expect(app.quits()).toBe(0);
            expect(line(closed, height - 1)).toMatch(/^⏎ open/);

            await app.press("?");
            await app.press("!");
            expect(await app.frame(), "the other overlay's key does nothing").toContain("Help · Runs");
            await app.press("c", { ctrl: true });
            expect(app.quits(), "Ctrl-c quits from an overlay").toBe(1);
        } finally {
            await app.stop();
        }
    });

    it("says there are no bad lines instead of opening an empty overlay", async () => {
        const app = await start();
        try {
            const said = await app.press("!");
            expect(line(said, height - 1)).toMatch(/^no bad lines +spans\.jsonl/);
            expect(said).not.toContain("Bad lines");
        } finally {
            await app.stop();
        }
    });

    it("walks back from a seeded run to the run list", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }));
        try {
            expect(line(await app.frame(), 0)).toMatch(/^Runs › api · /);
            expect(line(await app.escape(), 0)).toBe("Runs");
            expect(line(await app.escape(), 0), "Esc on the bare Runs screen does nothing").toBe("Runs");
            expect(app.quits()).toBe(0);
        } finally {
            await app.stop();
        }
    });

    it("shows a live update in the status bar", async () => {
        const app = await start();
        try {
            expect(line(await app.frame(), height - 1)).toMatch(/2 runs · 2 spans$/);
            const updated = await app.publish(
                indexed([
                    record({ span: "a", run: "run-1" }),
                    record({ span: "b", run: "run-2" }),
                    record({ span: "c", run: "run-3" }),
                ]),
            );
            expect(line(updated, height - 1)).toMatch(/3 runs · 3 spans$/);
        } finally {
            await app.stop();
        }
    });

    it("narrows a list as a query is typed, keeps it on Enter and clears it on Esc", async () => {
        const app = await start(Nav.initial, services);
        try {
            await app.press("/");
            await app.type("shop");
            const narrowed = await app.settle();
            expect(narrowed).toContain("shop-api");
            expect(narrowed).not.toContain("billing");
            expect(line(narrowed, height - 1)).toMatch(/^\/ shop▏ +1 of 3 runs$/);
            const kept = await app.enter();
            expect(line(kept, height - 1)).toMatch(/^\/ shop · 1 of 3 /);
            expect(kept).not.toContain("billing");
            const cleared = await app.escape();
            expect(cleared).toContain("billing");
            expect(line(cleared, height - 1)).toMatch(/^⏎ open/);
        } finally {
            await app.stop();
        }
    });

    it("selects a clicked row, and opens it on a second click", async () => {
        const app = await start(Nav.initial, services);
        try {
            const before = await app.frame();
            const billingRow = lineIndex(before, "billing");
            await app.click(10, billingRow);
            expect(line(await app.press("j"), 0), "the click selected billing, so j moved past it").toBe("Runs");
            await app.press("k");
            const opened = await app.click(10, billingRow);
            expect(line(opened, 0)).toMatch(/^Runs › billing · /);
        } finally {
            await app.stop();
        }
    });

    it("picks nothing when a press is released over another row", async () => {
        const app = await start(Nav.initial, services);
        try {
            const before = await app.frame();
            await app.drag(lineIndex(before, "agent"), lineIndex(before, "billing"));
            expect(line(await app.enter(), 0)).toMatch(/^Runs › agent · /);
        } finally {
            await app.stop();
        }
    });

    it("scrolls with the wheel without moving the selection, and a key snaps back", async () => {
        const many = indexed(
            Array.from({ length: 40 }, (_, i) =>
                record({ span: `s${i}`, run: `run-${i}`, service: `svc-${i}`, trace: `t${i}`, startMs: 1000 + i }),
            ),
        );
        const app = await start(Nav.initial, many);
        try {
            const top = line(await app.frame(), 2);
            expect(top).toContain("svc-39");
            const scrolled = await app.wheel(10, 5, "down");
            expect(line(scrolled, 2)).toContain("svc-36");
            expect(scrolled).not.toContain("svc-39");
            const snapped = await app.press("j");
            expect(line(snapped, 2), "j moved the selection to svc-38, back in view").toContain("svc-39");
        } finally {
            await app.stop();
        }
    });

    it("keeps the selected run on its screen line when newer runs arrive above it", async () => {
        const runsOf = (count: number) =>
            Array.from({ length: count }, (_, i) =>
                record({ span: `s${i}`, run: `run-${i}`, service: `svc-${i}`, trace: `t${i}`, startMs: 1000 + i }),
            );
        const app = await start(Nav.initial, indexed(runsOf(40)));
        try {
            await app.press("G");
            const before = await app.press("u", { ctrl: true });
            const row = lineIndex(before, "svc-8 ");
            expect(row, "half a page up a scrolled window").toBe(10);
            const after = await app.publish(indexed(runsOf(42)));
            expect(lineIndex(after, "svc-8 ")).toBe(row);
            expect(line(after, height - 1)).toMatch(/↑ 2 new/);
            const moved = await app.press("j");
            expect(lineIndex(moved, "svc-7 "), "the selection held").toBe(row + 1);
        } finally {
            await app.stop();
        }
    });

    const BODY_SHA = "f".repeat(64);
    const requestBody = JSON.stringify({
        card: "visa",
        notes: ["no refund yet", "customer asked twice", "refund the charge"],
        amount: 42,
    });
    const orders = [
        record({ span: "root", trace: "t1", name: "POST /orders", startMs: 1000, ms: 40, exit: "Failure" }),
        record({ span: "auth", trace: "t1", parent: "root", name: "auth.check", startMs: 1001, ms: 2 }),
        record({
            span: "pay",
            trace: "t1",
            parent: "root",
            name: "payment.charge",
            startMs: 1003,
            ms: 30,
            exit: "Failure",
        }),
        record({
            span: "try",
            trace: "t1",
            parent: "pay",
            name: "payment.attempt",
            startMs: 1004,
            ms: 20,
            exit: "Failure",
            attrs: {
                "http.request.sha256": BODY_SHA,
                "http.request.bytes": requestBody.length,
                "http.request.preview": requestBody.slice(0, 20),
            },
        }),
        record({ span: "mail", trace: "t1", parent: "root", name: "email.send", startMs: 1035, ms: 4 }),
    ];

    it("opens a trace on its failure origin, drills into a body, moves and folds in the tree, and goes back on Esc", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }), indexed(orders), {
            [BODY_SHA]: requestBody,
        });
        try {
            const trace = await app.enter();
            expect(line(trace, 0)).toMatch(/ › POST \/orders t1$/);
            expect(trace).toContain("1 Tree");
            expect(trace, "the origin's details").toMatch(/payment\.attempt +✗ Failure/);
            expect(line(await app.press("b"), 1), "the body is still being read").toBe(
                "http.request · payment.attempt · 96 B",
            );
            const body = await app.settle();
            expect(line(body, 0)).toMatch(/ › POST \/orders t1 › http\.request$/);
            expect(line(body, 1)).toMatch(/^http\.request · payment\.attempt · 96 B · json · L 1–9 \/ 9$/);
            expect(line(body, 3)).toBe('  "card": "visa",');
            const back = await app.escape();
            expect(back, "back on the trace, the origin still selected").toMatch(/payment\.attempt +✗ Failure/);
            const up = await app.press("k");
            expect(up).toMatch(/payment\.charge +✗ Failure/);
            const folded = await app.enter();
            expect(folded, "the child's tree row is gone").not.toMatch(/└ +payment\.attempt/);
            expect(folded).toContain("▸ payment.charge");
            expect(line(await app.escape(), 0), "Esc goes back to the traces").toMatch(/^Runs › api · /);
        } finally {
            await app.stop();
        }
    });

    it("moves the tree selection to the first match as a search is typed", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }), indexed(orders));
        try {
            await app.enter();
            await app.press("g");
            await app.press("/");
            const typed = await app.type("email");
            expect(typed).toMatch(/email\.send +Success/);
            expect(line(typed, height - 1)).toMatch(/^\/ email▏ +match 1\/1$/);
        } finally {
            await app.stop();
        }
    });

    it("keeps the selected span on its screen line when spans arrive above it", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }), indexed(orders));
        try {
            const before = await app.enter();
            const row = lineIndex(before, "payment.attempt ");
            const early = Arr.makeBy(3, (i) =>
                record({ span: `early${i}`, trace: "t1", parent: "root", name: `early.${i}`, startMs: 1000.5, ms: 1 }),
            );
            const after = await app.publish(indexed([...orders, ...early]));
            expect(after).toContain("early.2");
            expect(lineIndex(after, "payment.attempt "), "the selected row held its line").toBe(row);
            expect(after, "the selection did not move").toMatch(/payment\.attempt +✗ Failure/);
        } finally {
            await app.stop();
        }
    });

    it("searches a body, steps through its matches, copies it and opens it in the editor", async () => {
        const app = await start(initialNav({ run: Option.some("run-1"), trace: Option.none() }), indexed(orders), {
            [BODY_SHA]: requestBody,
        });
        try {
            await app.enter();
            await app.press("b");
            await app.settle();
            await app.press("/");
            const typed = await app.type("refund");
            expect(line(typed, height - 1)).toMatch(/^\/ refund▏ +2 matches$/);
            expect(line(typed, 1), "typing highlights without a current match").toMatch(/ · 2 matches$/);
            const submitted = await app.enter();
            expect(line(submitted, 1)).toMatch(/ · match 1\/2$/);
            expect(line(submitted, height - 1)).toMatch(/^\/ refund · match 1\/2 /);
            expect(line(await app.press("n"), 1)).toMatch(/ · match 2\/2$/);
            expect(line(await app.press("n"), 1), "wrapping around").toMatch(/ · match 1\/2$/);

            const copied = await app.press("y");
            const pretty = JSON.stringify(JSON.parse(requestBody), null, 2);
            expect(app.copies()).toEqual([pretty]);
            expect(line(copied, height - 1)).toMatch(new RegExp(`^copied ${pretty.length} B `));
            await app.press("e");
            expect(app.edits()).toEqual([
                {
                    file: expect.stringMatching(new RegExp(`/bodies/${BODY_SHA}\\.txt$`)),
                    line: Option.none(),
                    col: Option.none(),
                },
            ]);

            const cleared = await app.escape();
            expect(line(cleared, 1), "the first Esc clears the search").toMatch(/ · L 1–9 \/ 9$/);
            expect(line(await app.escape(), 0), "the second goes back").toMatch(/ › POST \/orders t1$/);
        } finally {
            await app.stop();
        }
    });
});
