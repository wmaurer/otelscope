import { assemble, layoutOf, listKey, stageOf } from "../../src/model/screenList.ts";
import { top } from "../../src/nav/Nav.ts";
import { activeQuery } from "../../src/nav/Query.ts";
import { record } from "./records.ts";

import type { Exit, Snapshot } from "../../src/data/Snapshot.ts";
import type { ScreenList } from "../../src/model/screenList.ts";
import type { Nav } from "../../src/nav/Nav.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export const rootSpan = (
    trace: string,
    name: string,
    startMs: number,
    exit: Exit = "Success",
    over: Partial<JsonlSpanRecord> = {},
): JsonlSpanRecord => record({ span: `${trace}-root`, trace, name, startMs, ms: 10, exit, ...over });

export const namedTraces = (
    prefix: string,
    name: string,
    count: number,
    from: number,
    failing: ReadonlySet<number> = new Set(),
): ReadonlyArray<JsonlSpanRecord> =>
    Array.from({ length: count }, (_, i) =>
        rootSpan(
            `${prefix}${String(i).padStart(3, "0")}`,
            name,
            from + i * 1000,
            failing.has(i) ? "Failure" : "Success",
        ),
    );

/** The list the app builds for the top screen. */
export const listFor = (nav: Nav, snapshot: Snapshot, now = 0): ScreenList => {
    const screen = top(nav);
    const stage = stageOf(listKey(screen, activeQuery(nav), snapshot, now), snapshot);
    return assemble(stage, layoutOf(stage, screen));
};
