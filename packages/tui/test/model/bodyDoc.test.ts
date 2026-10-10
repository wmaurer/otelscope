import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Option } from "effect";

import { detect, docOf } from "../../src/model/bodyDoc.ts";

import type { BodyDoc } from "../../src/model/bodyDoc.ts";

const formatted = (text: string): BodyDoc => docOf(text, detect(text), false);

/** Each colour run as the text it covers and its role. */
const runsOf = (doc: BodyDoc) =>
    Arr.map(doc.runs.role, (role, i) => [doc.text.slice(doc.runs.start[i], doc.runs.end[i]), role] as const);

const lines = (doc: BodyDoc) => doc.text.split("\n");

const sampleBody = (sha256: string) =>
    readFileSync(new URL(`../fixtures/sample/bodies/${sha256}.txt`, import.meta.url), "utf8");

describe("detect", () => {
    it("parses text that starts with { or [ after whitespace", () => {
        expect(detect('  \n{"a":1}')).toEqual(Option.some({ a: 1 }));
        expect(detect("[1,2]")).toEqual(Option.some([1, 2]));
    });

    it("leaves other JSON values and broken JSON as text", () => {
        expect(detect('"a string"')).toEqual(Option.none());
        expect(detect("42")).toEqual(Option.none());
        expect(detect('{"a":')).toEqual(Option.none());
        expect(detect("<html></html>")).toEqual(Option.none());
    });
});

describe("docOf", () => {
    it("pretty-prints a compact body with two-space indents", () => {
        const doc = formatted('{"model":"m","n":3,"ok":true,"none":null,"messages":[{"role":"user"}]}');
        expect(doc.kind).toBe("json");
        expect(lines(doc)).toEqual([
            "{",
            '  "model": "m",',
            '  "n": 3,',
            '  "ok": true,',
            '  "none": null,',
            '  "messages": [',
            "    {",
            '      "role": "user"',
            "    }",
            "  ]",
            "}",
        ]);
    });

    it("colours keys, strings, numbers and literals at their offsets", () => {
        const doc = formatted('{"model":"m","n":-3.5,"ok":false,"none":null}');
        expect(runsOf(doc)).toEqual([
            ['"model"', "jsonKey"],
            ['"m"', "jsonString"],
            ['"n"', "jsonKey"],
            ["-3.5", "jsonNumber"],
            ['"ok"', "jsonKey"],
            ["false", "jsonLiteral"],
            ['"none"', "jsonKey"],
            ["null", "jsonLiteral"],
        ]);
    });

    it("keeps empty objects and arrays on one line, nested or not", () => {
        expect(lines(formatted('{"a":{},"b":[],"c":[{}]}'))).toEqual([
            "{",
            '  "a": {},',
            '  "b": [],',
            '  "c": [',
            "    {}",
            "  ]",
            "}",
        ]);
        expect(formatted("[]").text).toBe("[]");
    });

    it("shows a string's \\n as real lines, indented two past its key, all in the string colour", () => {
        const doc = formatted('{"messages":[{"content":"Summarise the invoice\\nand list\\tthe items"}]}');
        expect(lines(doc)).toEqual([
            "{",
            '  "messages": [',
            "    {",
            '      "content": "Summarise the invoice',
            '        and list\\tthe items"',
            "    }",
            "  ]",
            "}",
        ]);
        expect(runsOf(doc)[2]).toEqual(['"Summarise the invoice\n        and list\\tthe items"', "jsonString"]);
    });

    it("indents a multi-line string in an array two past its own line", () => {
        expect(lines(formatted('["one\\ntwo","x"]'))).toEqual(["[", '  "one', '    two",', '  "x"', "]"]);
    });

    it("shows a truncated JSON body as plain text, exactly as stored", () => {
        const text = sampleBody("9fb8c8ce1d3f8624d02aed5da639b558e9eb8c6250a8686eabf4f09c05107596");
        const doc = formatted(text);
        expect(text.startsWith("[{")).toBe(true);
        expect(doc.kind).toBe("text");
        expect(doc.text).toBe(text);
        expect(doc.runs.role).toEqual([]);
    });

    it("shows the stored text in raw view and still reports json", () => {
        const text = '{"a": [1,\n2]}';
        const doc = docOf(text, detect(text), true);
        expect(doc).toMatchObject({ kind: "json", raw: true, text });
        expect(doc.runs.role).toEqual([]);
    });

    it("falls back to text when the nesting is too deep to walk", () => {
        const text = `${"[".repeat(200_000)}${"]".repeat(200_000)}`;
        const doc = formatted(text);
        expect(doc.kind).toBe("text");
        expect(doc.text).toBe(text);
    });

    it("records where each line starts, with a sentinel past the end", () => {
        expect(docOf("ab\n\ncd", Option.none(), false).lineStarts).toEqual([0, 3, 4, 7]);
        expect(docOf("", Option.none(), false).lineStarts).toEqual([0, 1]);
    });
});
