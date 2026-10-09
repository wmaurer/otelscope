import { Option } from "effect";

import * as Nav from "../../src/nav/Nav.ts";
import { bodyFor, defaultRunsView, defaultTraceView, Screen, tracesFor } from "../../src/nav/Screen.ts";

import type { KeyPress } from "../../src/keys/Key.ts";
import type { Pane, TraceView } from "../../src/nav/Screen.ts";

const plain = (name: string, sequence = name): KeyPress => ({ name, sequence, ctrl: false, meta: false, shift: false });

export const press = (key: string): KeyPress => {
    switch (key) {
        case "return":
            return plain("return", "\r");
        case "escape":
            return plain("escape", "\u001b");
        case "space":
            return plain("space", " ");
        case "tab":
            return plain("tab", "\t");
        case "shift+tab":
            return { ...plain("tab", "\u001b[Z"), shift: true };
        case "up":
            return plain("up", "\u001b[A");
        case "down":
            return plain("down", "\u001b[B");
        case "left":
            return plain("left", "\u001b[D");
        case "right":
            return plain("right", "\u001b[C");
        case "pageup":
            return plain("pageup", "\u001b[5~");
        case "pagedown":
            return plain("pagedown", "\u001b[6~");
        case "home":
            return plain("home", "\u001b[H");
        case "end":
            return plain("end", "\u001b[F");
    }
    if (key.startsWith("ctrl+")) {
        const letter = key.slice(5);
        return { ...plain(letter, String.fromCharCode(letter.charCodeAt(0) - 96)), ctrl: true };
    }
    if (key >= "A" && key <= "Z") {
        return { ...plain(key.toLowerCase(), key), shift: true };
    }
    return plain(key);
};

export const runs = Nav.initial;
export const runsFiltered = Nav.update(Nav.initial, "Runs", (view) => ({ ...view, filter: "shop" }));
export const traces = Nav.push(Nav.initial, tracesFor("run-1", defaultRunsView));
export const tracesFiltered = Nav.update(traces, "Traces", (view) => ({ ...view, filter: "pay" }));

export const trace = (pane: Pane, view: Partial<TraceView> = {}): Nav.Nav =>
    Nav.push(
        traces,
        Screen.Trace({
            traceId: "trace-1",
            idIsPrefix: false,
            viaRun: Option.some("run-1"),
            view: { ...defaultTraceView, pane, ...view },
        }),
    );

export const body = Nav.push(trace("tree"), bodyFor("trace-1", "span-1", "llm.request"));
export const bodySearching = Nav.update(body, "Body", (view) => ({ ...view, search: "error" }));
