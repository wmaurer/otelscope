import { assert, describe, it } from "@effect/vitest";

import { parseFrame } from "../src/Sites.ts";

describe("parseFrame", () => {
    it("reads the first frame of a tsx or CommonJS stack, dropping the function name", () => {
        assert.deepStrictEqual(
            parseFrame("Error\n    at <anonymous> (/app/src/main.ts:32:40)\n    at run (/app/src/run.ts:1:1)"),
            { file: "/app/src/main.ts", line: 32, col: 40 },
        );
    });

    it("reads a Node ESM frame, converting the file URL to a path", () => {
        assert.deepStrictEqual(parseFrame("Error\n    at file:///app/my%20dist/main.mjs:7:3"), {
            file: "/app/my dist/main.mjs",
            line: 7,
            col: 3,
        });
    });

    it("gives undefined for a stack without a file frame", () => {
        assert.isUndefined(parseFrame("Error\n    at new Promise (<anonymous>)"));
        assert.isUndefined(parseFrame(undefined));
    });
});
