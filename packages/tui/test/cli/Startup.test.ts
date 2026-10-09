import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";

import * as Startup from "../../src/cli/Startup.ts";

import type { CliArgs } from "../../src/cli/Args.ts";

const terminal: Startup.TtyState = { stdin: true, stdout: true };
const piped: Startup.TtyState = { stdin: false, stdout: false };

const cliArgs = (file: string, follow: boolean): CliArgs => ({
    file,
    follow,
    run: Option.none(),
    trace: Option.none(),
});

const check = (args: CliArgs, tty: Startup.TtyState) =>
    Startup.check(args, tty).pipe(Effect.provide(NodeServices.layer));

const failure = (args: CliArgs, tty: Startup.TtyState) => Effect.flip(check(args, tty));

const tempDir = () => mkdtempSync(join(tmpdir(), "otelscope-startup-"));

const readableFile = () => {
    const file = join(tempDir(), "spans.jsonl");
    writeFileSync(file, "");
    return file;
};

describe("Startup.check", () => {
    it.effect("passes a readable file in a terminal", () =>
        Effect.gen(function* () {
            expect(Exit.isSuccess(yield* Effect.exit(check(cliArgs(readableFile(), true), terminal)))).toBe(true);
        }),
    );

    it.effect("passes a missing file it will follow, in a terminal", () =>
        Effect.gen(function* () {
            const file = join(tempDir(), "later.jsonl");
            expect(Exit.isSuccess(yield* Effect.exit(check(cliArgs(file, true), terminal)))).toBe(true);
        }),
    );

    it.effect("reports a missing directory before anything else", () =>
        Effect.gen(function* () {
            const dir = join(tempDir(), "missing");
            const error = yield* failure(cliArgs(join(dir, "spans.jsonl"), false), piped);
            expect(error).toEqual(new Startup.NoSuchDirectory({ dir }));
            expect(error.message).toBe(`no such directory: ${dir}`);
        }),
    );

    it.effect("reports a file whose parent is not a directory as a missing directory", () =>
        Effect.gen(function* () {
            const parent = readableFile();
            const error = yield* failure(cliArgs(join(parent, "spans.jsonl"), true), piped);
            expect(error).toEqual(new Startup.NoSuchDirectory({ dir: parent }));
        }),
    );

    it.effect("reports a directory", () =>
        Effect.gen(function* () {
            const dir = tempDir();
            const error = yield* failure(cliArgs(dir, true), piped);
            expect(error).toEqual(new Startup.IsDirectory({ path: dir }));
            expect(error.message).toBe(`is a directory: ${dir}`);
        }),
    );

    it.effect("reports a missing file under --no-follow", () =>
        Effect.gen(function* () {
            const file = join(tempDir(), "spans.jsonl");
            const error = yield* failure(cliArgs(file, false), piped);
            expect(error).toEqual(new Startup.NoSuchFile({ path: file }));
            expect(error.message).toBe(`no such file: ${file}`);
        }),
    );

    // Root reads any file regardless of its mode, so the check has nothing to report there.
    it.effect.skipIf(process.getuid?.() === 0)("reports a file it cannot read, with the reason", () =>
        Effect.gen(function* () {
            const file = readableFile();
            chmodSync(file, 0o000);
            const error = yield* failure(cliArgs(file, true), piped);
            expect(error).toEqual(new Startup.CannotRead({ path: file, reason: "permission denied" }));
            expect(error.message).toBe(`cannot read ${file}: permission denied`);
        }),
    );

    it.effect("checks the terminal last, for stdin and for stdout", () =>
        Effect.gen(function* () {
            const file = readableFile();
            const missing = join(tempDir(), "later.jsonl");
            expect(yield* failure(cliArgs(file, true), piped)).toEqual(new Startup.NotATty());
            expect(yield* failure(cliArgs(missing, true), piped)).toEqual(new Startup.NotATty());
            expect(yield* failure(cliArgs(file, true), { stdin: false, stdout: true })).toEqual(new Startup.NotATty());
            expect(yield* failure(cliArgs(file, true), { stdin: true, stdout: false })).toEqual(new Startup.NotATty());
            expect(new Startup.NotATty().message).toBe("needs an interactive terminal");
        }),
    );
});
