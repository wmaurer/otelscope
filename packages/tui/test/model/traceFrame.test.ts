import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { defaultPanes } from "../../src/model/panes.ts";
import { traceFrame } from "../../src/model/traceFrame.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { defaultTraceView, Screen } from "../../src/nav/Screen.ts";
import { indexed } from "../support/store.ts";
import { span, traceModelFor } from "../support/traces.ts";

describe("traceFrame", () => {
    it("starts each bar no left of its parent's drawn start, even when a skewed clock starts it earlier", () => {
        const snapshot = indexed([
            span("root", null, 0, { ms: 100 }),
            span("late", "root", 50, { ms: 40 }),
            span("early", "late", 10, { ms: 10 }),
            span("between", "early", 30, { ms: 5 }),
        ]);
        const nav = Nav.push(
            Nav.initial,
            Screen.Trace({ traceId: "trace-1", idIsPrefix: false, viaRun: Option.none(), view: defaultTraceView }),
        );
        const frame = traceFrame(Option.getOrThrow(traceModelFor(nav, snapshot)), defaultTraceView, {
            size: { width: 120, height: 40 },
            panes: defaultPanes,
            now: 0,
            snapshot,
            bodyStats: new Map(),
        });
        const startOf = (index: number) => frame.tree.bar(index)[0]?.x;
        expect(frame.tree.keyAt(1)).toBe("s:late");
        expect(startOf(1)).toBeGreaterThan(startOf(0) ?? 0);
        expect(startOf(2), "early starts before its parent").toBe(startOf(1));
        expect(startOf(3), "between starts after its parent, but before its grandparent").toBe(startOf(1));
    });
});
