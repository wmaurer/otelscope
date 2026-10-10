import { Array as Arr } from "effect";

import { record } from "./records.ts";
import { indexed } from "./store.ts";

import type { Trace } from "../../src/data/Snapshot.ts";
import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

/** A span named after its id unless `over` names it. */
export const span = (
    id: string,
    parent: string | null,
    startMs: number,
    over: Partial<JsonlSpanRecord> = {},
): JsonlSpanRecord => record({ span: id, parent, name: id, startMs, ...over });

export const traceOf = (records: ReadonlyArray<JsonlSpanRecord>, id = "trace-1"): Trace => {
    const trace = indexed(records).traces.get(id);
    if (trace === undefined) {
        throw new Error(`no trace ${id}`);
    }
    return trace;
};

/** `count` siblings named `name` under `parent`, ids `<prefix>-000`…, starting 1 ms apart. */
export const siblings = (
    prefix: string,
    parent: string | null,
    name: string,
    count: number,
    from: number,
    over: (i: number) => Partial<JsonlSpanRecord> = () => ({}),
): ReadonlyArray<JsonlSpanRecord> =>
    Arr.makeBy(count, (i) => span(`${prefix}-${String(i).padStart(3, "0")}`, parent, from + i, { name, ...over(i) }));
