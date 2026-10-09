import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";

const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const sample = fileURLToPath(new URL("fixtures/sample/spans.jsonl", import.meta.url));

// Piped stdio, so the process never sees a terminal.
const otelscope = (...argv: ReadonlyArray<string>) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, ["--conditions=@otelscope/source", bin, ...argv], {
        encoding: "utf8",
    });
    return { status, stdout, stderr };
};

const tempDir = () => mkdtempSync(join(tmpdir(), "otelscope-bin-"));

describe("otelscope bin", () => {
    it("exits 2 with the usage on stderr when no file is given", () => {
        const { status, stdout, stderr } = otelscope();
        expect(status).toBe(2);
        expect(stdout).toBe("");
        expect(stderr).toContain("USAGE\n  otelscope [flags] <file>");
        expect(stderr).toContain("Missing required argument: file");
    });

    it("prints the version and exits 0", () => {
        expect(otelscope("--version")).toEqual({ status: 0, stdout: "otelscope 0.1.0\n", stderr: "" });
    });

    it("exits 1 for a readable file, because it needs a terminal", () => {
        expect(otelscope(sample)).toEqual({
            status: 1,
            stdout: "",
            stderr: "otelscope: needs an interactive terminal\n",
        });
    });

    it("exits 1 for a directory", () => {
        const dir = tempDir();
        expect(otelscope(dir)).toEqual({ status: 1, stdout: "", stderr: `otelscope: is a directory: ${dir}\n` });
    });

    it("exits 1 when the file's directory is missing", () => {
        const dir = join(tempDir(), "missing");
        expect(otelscope(join(dir, "spans.jsonl"))).toEqual({
            status: 1,
            stdout: "",
            stderr: `otelscope: no such directory: ${dir}\n`,
        });
    });

    it("exits 1 for a missing file under --no-follow", () => {
        const file = join(tempDir(), "spans.jsonl");
        expect(otelscope("--no-follow", file)).toEqual({
            status: 1,
            stdout: "",
            stderr: `otelscope: no such file: ${file}\n`,
        });
    });

    it("waits for a missing file it follows, so only the terminal check fails", () => {
        const file = join(tempDir(), "spans.jsonl");
        expect(otelscope(file)).toEqual({
            status: 1,
            stdout: "",
            stderr: "otelscope: needs an interactive terminal\n",
        });
    });
});
