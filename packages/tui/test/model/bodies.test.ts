import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

import { bodiesOf, bodyState } from "../../src/model/bodies.ts";
import { record } from "../support/records.ts";

describe("bodiesOf", () => {
    it("lists one body per `.sha256` string attribute, sorted by prefix", () => {
        const span = record({
            span: "s",
            attrs: {
                "http.response.sha256": "bbb",
                "http.response.bytes": 2048,
                "http.response.preview": '{"ok":true}',
                "http.request.sha256": "aaa",
                "http.request.bytes": 12,
                "http.request.preview": "hello",
                "odd.sha256": 7,
                "http.request.method": "POST",
            },
        });
        expect(bodiesOf(span)).toEqual([
            { prefix: "http.request", sha256: "aaa", bytes: 12, preview: "hello" },
            { prefix: "http.response", sha256: "bbb", bytes: 2048, preview: '{"ok":true}' },
        ]);
    });

    it("is empty for a span without bodies", () => {
        expect(bodiesOf(record({ span: "s", attrs: { "a.bytes": 3 } }))).toEqual([]);
    });
});

describe("bodyState", () => {
    const ref = { prefix: "p", sha256: "abc", bytes: 100, preview: "" };

    it("compares the file's size with `.bytes`", () => {
        expect(bodyState(ref, Option.some(AsyncResult.success(Option.some(100))))).toBe("ok");
        expect(bodyState(ref, Option.some(AsyncResult.success(Option.some(40))))).toBe("truncated");
        expect(bodyState(ref, Option.some(AsyncResult.success(Option.none())))).toBe("missing");
    });

    it("is unknown before the stat is loaded", () => {
        expect(bodyState(ref, Option.none())).toBe("unknown");
        expect(bodyState(ref, Option.some(AsyncResult.initial(true)))).toBe("unknown");
    });
});
