import { Option } from "effect";

import { chunk } from "./Role.ts";

import type { Phase, Run, Trace } from "../data/Snapshot.ts";
import type { Chunk, Line } from "./Role.ts";

const LIVE_MILLIS = 5000;

export const isLive = (lastArrivalAt: Option.Option<number>, phase: Phase, now: number): boolean =>
    phase === "following" && Option.exists(lastArrivalAt, (at) => now - at < LIVE_MILLIS);

export type TraceState = "failed" | "recovered" | "interrupted" | "running" | "partial" | "ok";

export const traceState = (trace: Trace, live: boolean): TraceState =>
    Option.match(trace.rootExit, {
        onNone: () => (live ? "running" : "partial"),
        onSome: (exit) => {
            switch (exit) {
                case "Failure":
                    return "failed";
                case "Interrupted":
                    return "interrupted";
                case "Success":
                    return trace.failedSpans > 0 ? "recovered" : "ok";
            }
        },
    });

export const isProblem = (state: TraceState): boolean => state === "failed" || state === "interrupted";

export const isNotable = (state: TraceState): boolean =>
    state === "failed" || state === "interrupted" || state === "running";

export const isProblemRun = (run: Run): boolean => run.failedTraces > 0;

const marks = {
    failed: chunk("✗", "failure"),
    recovered: chunk("✗", "failurePropagated"),
    interrupted: chunk("⊘", "interrupted"),
    running: chunk("▸", "accent"),
    partial: chunk("?", "muted"),
    ok: chunk(" ", "text"),
} satisfies Readonly<Record<TraceState, Chunk>>;

export const traceMark = (state: TraceState): Chunk => marks[state];

export const runMarks = (run: Run, live: boolean): Line => [
    live ? chunk("●", "live") : chunk(" ", "text"),
    run.failedTraces > 0
        ? marks.failed
        : run.failedSpans > 0
          ? marks.recovered
          : run.interruptedSpans > 0
            ? marks.interrupted
            : marks.ok,
];
