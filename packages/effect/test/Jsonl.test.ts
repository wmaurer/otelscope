import { assert, describe, it } from "@effect/vitest";

import { toLines, toRecord } from "../src/Jsonl.ts";
import { otlpSpan, str } from "./support/spans.ts";

describe("toRecord", () => {
    it("maps ids, parent and run", () => {
        const record = toRecord("run-1", otlpSpan({ name: "agent.match", spanId: "00f067", parentSpanId: "a3ce92" }));

        assert.strictEqual(record.run, "run-1");
        assert.strictEqual(record.trace, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert.strictEqual(record.span, "00f067");
        assert.strictEqual(record.parent, "a3ce92");
        assert.strictEqual(record.name, "agent.match");
        assert.isNull(toRecord("run-1", otlpSpan({ name: "cli.plan", spanId: "a3ce92" })).parent);
    });

    it("rounds the nanosecond duration to whole milliseconds", () => {
        const record = toRecord(
            "r",
            otlpSpan({
                name: "slow",
                spanId: "s1",
                startTimeUnixNano: "1757000000500000000",
                endTimeUnixNano: "1757000004731400000",
            }),
        );

        assert.strictEqual(record.ms, 4231);
    });

    it("reports Failure for an error status, Interrupted for an interrupted span, and Success otherwise", () => {
        const failed = otlpSpan({ name: "bad", spanId: "s1", status: { code: 2, message: "boom" } });
        const interrupted = otlpSpan({
            name: "cut",
            spanId: "s2",
            status: { code: 1, message: "Interrupted" },
            attributes: [{ key: "status.interrupted", value: { boolValue: true } }],
        });
        const ok = otlpSpan({ name: "good", spanId: "s3" });

        assert.strictEqual(toRecord("r", failed).exit, "Failure");
        assert.strictEqual(toRecord("r", interrupted).exit, "Interrupted");
        assert.strictEqual(toRecord("r", ok).exit, "Success");
    });

    it("converts OTLP attribute values back to plain JSON values", () => {
        const record = toRecord(
            "r",
            otlpSpan({
                name: "s",
                spanId: "s1",
                attributes: [
                    str("ticket.key", "PROJ-412"),
                    { key: "prompt.bytes", value: { intValue: 292_626 } },
                    { key: "count", value: { intValue: "42" } },
                    { key: "ratio", value: { doubleValue: 0.5 } },
                    { key: "nan", value: { doubleValue: null } },
                    { key: "cached", value: { boolValue: false } },
                    {
                        key: "gen_ai.response.finish_reasons",
                        value: { arrayValue: { values: [{ stringValue: "stop" }] } },
                    },
                ],
            }),
        );

        assert.deepStrictEqual(record.attrs, {
            "ticket.key": "PROJ-412",
            "prompt.bytes": 292_626,
            count: 42,
            ratio: 0.5,
            nan: null,
            cached: false,
            "gen_ai.response.finish_reasons": ["stop"],
        });
    });

    it("carries the span events, timed from the start of the span", () => {
        const record = toRecord(
            "r",
            otlpSpan({
                name: "agent.match",
                spanId: "s1",
                events: [
                    {
                        name: "rate limited, retrying",
                        timeUnixNano: "1757000001700000000",
                        attributes: [str("effect.logLevel", "WARN"), str("ticket.key", "PROJ-412")],
                        droppedAttributesCount: 0,
                    },
                ],
            }),
        );

        assert.deepStrictEqual(record.events, [
            {
                name: "rate limited, retrying",
                offsetMs: 1200,
                attrs: { "effect.logLevel": "WARN", "ticket.key": "PROJ-412" },
            },
        ]);
    });
});

describe("toLines", () => {
    it("writes one parseable line per span", () => {
        const text = toLines("r", [otlpSpan({ name: "a", spanId: "s1" }), otlpSpan({ name: "b", spanId: "s2" })]);

        const lines = text.split("\n");
        assert.lengthOf(lines, 3);
        assert.strictEqual(lines[2], "");
        assert.strictEqual(JSON.parse(lines[1] ?? "").name, "b");
    });
});
