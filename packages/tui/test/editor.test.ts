import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { invocation, locationTarget } from "../src/editor.ts";
import { record } from "./support/records.ts";

const at = (file: string, line?: number, col?: number) => ({
    file,
    line: Option.fromUndefinedOr(line),
    col: Option.fromUndefinedOr(col),
});

describe("invocation", () => {
    it("passes --goto to VS Code style editors, keeping the command's own flags", () => {
        expect(invocation({ VISUAL: "code --wait" }, "/repo", at("src/a.ts", 12, 4))).toEqual(
            Option.some({ command: "code", args: ["--wait", "--goto", "/repo/src/a.ts:12:4"] }),
        );
        expect(invocation({ EDITOR: "/usr/bin/cursor" }, "/repo", at("/abs/b.ts", 3, 1))).toEqual(
            Option.some({ command: "/usr/bin/cursor", args: ["--goto", "/abs/b.ts:3:1"] }),
        );
    });

    it("passes +line to every other editor, $VISUAL winning over $EDITOR", () => {
        expect(invocation({ VISUAL: "nvim", EDITOR: "nano" }, "/repo/", at("x.ts", 7, 2))).toEqual(
            Option.some({ command: "nvim", args: ["+7", "/repo/x.ts"] }),
        );
        expect(invocation({ EDITOR: "my-editor" }, "/r", at("x.ts", 7))).toEqual(
            Option.some({ command: "my-editor", args: ["+7", "/r/x.ts"] }),
        );
    });

    it("opens a file without a line as just the file", () => {
        expect(invocation({ EDITOR: "vim" }, "/r", at("/b/body.txt"))).toEqual(
            Option.some({ command: "vim", args: ["/b/body.txt"] }),
        );
    });

    it("runs nothing when no editor is set", () => {
        expect(invocation({}, "/r", at("x.ts", 1))).toEqual(Option.none());
        expect(invocation({ VISUAL: "  ", EDITOR: "" }, "/r", at("x.ts", 1))).toEqual(Option.none());
    });
});

describe("locationTarget", () => {
    it("prefers the definition, then the call site", () => {
        const site = { file: "fixture/scenarios.ts", line: 154, col: 16 };
        const def = { file: "fixture/scenarios.ts", line: 96, col: 30 };
        expect(locationTarget(record({ span: "a", site, def }))).toEqual(Option.some(at(def.file, 96, 30)));
        expect(locationTarget(record({ span: "a", site }))).toEqual(Option.some(at(site.file, 154, 16)));
        expect(locationTarget(record({ span: "a" }))).toEqual(Option.none());
    });
});
