import { assert, describe, it } from "@effect/vitest";
import { Array as Arr, Exit, Option, Schema } from "effect";

import { JsonlSpanRecord, toLines, toRecord } from "../../src/format/Jsonl.ts";
import { otlpSpan, str } from "../support/spans.ts";

import type { KeyValue } from "../../src/format/TraceData.ts";

const int = (key: string, value: number): KeyValue => ({ key, value: { intValue: value } });

describe("toRecord", () => {
    it("maps ids, parent, run and service", () => {
        const record = toRecord(
            "run-1",
            "shop-api",
            otlpSpan({ name: "agent.match", spanId: "00f067", parentSpanId: "a3ce92" }),
        );

        assert.strictEqual(record.run, "run-1");
        assert.strictEqual(record.service, "shop-api");
        assert.strictEqual(record.trace, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert.strictEqual(record.span, "00f067");
        assert.strictEqual(record.parent, "a3ce92");
        assert.strictEqual(record.name, "agent.match");
        assert.isNull(toRecord("run-1", "shop-api", otlpSpan({ name: "cli.plan", spanId: "a3ce92" })).parent);
    });

    it("times the start, the duration and each event to the microsecond, rounding half a microsecond up", () => {
        const record = toRecord(
            "r",
            "s",
            otlpSpan({
                name: "slow",
                spanId: "s1",
                startTimeUnixNano: "1791295407070068500",
                endTimeUnixNano: "1791295411301469000",
                events: [
                    {
                        name: "retry",
                        timeUnixNano: "1791295408270069000",
                        attributes: [],
                        droppedAttributesCount: 0,
                    },
                ],
            }),
        );

        assert.strictEqual(record.startMs, 1791295407070.069);
        assert.strictEqual(record.ms, 4231.401);
        assert.strictEqual(record.events[0]?.offsetMs, 1200.001);
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

        assert.strictEqual(toRecord("r", "s", failed).exit, "Failure");
        assert.strictEqual(toRecord("r", "s", interrupted).exit, "Interrupted");
        assert.strictEqual(toRecord("r", "s", ok).exit, "Success");
    });

    it("converts OTLP attribute values back to plain JSON values", () => {
        const record = toRecord(
            "r",
            "s",
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
            "s",
            otlpSpan({
                name: "agent.match",
                spanId: "s1",
                events: [
                    {
                        name: "sample warning",
                        timeUnixNano: "1757000001700000000",
                        attributes: [str("effect.logLevel", "WARN"), str("ticket.key", "PROJ-412")],
                        droppedAttributesCount: 0,
                    },
                ],
            }),
        );

        assert.deepStrictEqual(record.events, [
            {
                name: "sample warning",
                offsetMs: 1200,
                attrs: { "effect.logLevel": "WARN", "ticket.key": "PROJ-412" },
            },
        ]);
    });

    it("lifts the call site, the definition and the fiber out of attrs", () => {
        const record = toRecord(
            "r",
            "s",
            otlpSpan({
                name: "load",
                spanId: "s1",
                attributes: [
                    str("code.file.path", "/app/src/main.ts"),
                    int("code.line.number", 32),
                    int("code.column.number", 40),
                    str("otelscope.def.file.path", "/app/src/load.ts"),
                    int("otelscope.def.line.number", 7),
                    int("otelscope.def.column.number", 22),
                    int("otelscope.fiber.id", 14),
                    str("ticket.key", "PROJ-412"),
                ],
            }),
        );

        assert.deepStrictEqual(record.site, { file: "/app/src/main.ts", line: 32, col: 40 });
        assert.deepStrictEqual(record.def, { file: "/app/src/load.ts", line: 7, col: 22 });
        assert.strictEqual(record.fiber, 14);
        assert.deepStrictEqual(record.attrs, { "ticket.key": "PROJ-412" });
    });

    it("gives null for a partial location or a fiber that is not a number, and still removes the attributes", () => {
        const record = toRecord(
            "r",
            "s",
            otlpSpan({
                name: "load",
                spanId: "s1",
                attributes: [
                    str("code.file.path", "/app/src/main.ts"),
                    int("code.line.number", 32),
                    str("otelscope.def.file.path", "/app/src/load.ts"),
                    str("otelscope.def.line.number", "7"),
                    int("otelscope.def.column.number", 22),
                    str("otelscope.fiber.id", "14"),
                ],
            }),
        );

        assert.isNull(record.site);
        assert.isNull(record.def);
        assert.isNull(record.fiber);
        assert.deepStrictEqual(record.attrs, {});
    });

    it("gives null site, def and fiber to a span without those attributes", () => {
        const record = toRecord("r", "s", otlpSpan({ name: "plain", spanId: "s1" }));

        assert.isNull(record.site);
        assert.isNull(record.def);
        assert.isNull(record.fiber);
    });
});

describe("toLines", () => {
    it("writes one parseable line per span, each stamped with the service", () => {
        const text = toLines("r", "shop-api", [
            otlpSpan({ name: "a", spanId: "s1" }),
            otlpSpan({ name: "b", spanId: "s2" }),
        ]);

        const lines = text.split("\n");
        assert.lengthOf(lines, 3);
        assert.strictEqual(lines[2], "");
        const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(JsonlSpanRecord));
        const records = Arr.map(Arr.take(lines, 2), (line) => decodeLine(line));
        assert.deepStrictEqual(
            Arr.map(
                records,
                Option.map((r) => [r.name, r.service]),
            ),
            [Option.some(["a", "shop-api"]), Option.some(["b", "shop-api"])],
        );
    });
});

describe("JsonlSpanRecord", () => {
    const decode = Schema.decodeUnknownExit(JsonlSpanRecord);
    const decodeLine = Schema.decodeUnknownExit(Schema.fromJsonString(JsonlSpanRecord));
    const span = otlpSpan({
        name: "a",
        spanId: "s1",
        attributes: [
            str("code.file.path", "/app/src/main.ts"),
            int("code.line.number", 32),
            int("code.column.number", 40),
            int("otelscope.fiber.id", 3),
        ],
    });
    const record = toRecord("r", "shop-api", span);

    it("decodes a line the writer produces", () => {
        assert.deepStrictEqual(decodeLine(toLines("r", "shop-api", [span])), Exit.succeed(record));
    });

    it("rejects a 0.2 line, which has no startMs, service, site, def or fiber", () => {
        const old = {
            run: "r",
            trace: "4bf92f3577b34da6a3ce929d0e0e4736",
            span: "s1",
            parent: null,
            name: "a",
            ms: 4,
            exit: "Success",
            attrs: {},
            events: [],
        };

        assert.isTrue(Exit.isFailure(decode(old)));
    });

    it("drops unknown keys", () => {
        assert.deepStrictEqual(
            decodeLine(JSON.stringify({ ...record, gpu: "H100", extra: { nested: true } })),
            Exit.succeed(record),
        );
    });
});
