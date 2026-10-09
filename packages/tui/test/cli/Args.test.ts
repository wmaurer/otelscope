import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Schema } from "effect";
import { TestConsole } from "effect/testing";

import * as Args from "../../src/cli/Args.ts";

const PackageJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const text = (lines: ReadonlyArray<unknown>) => Arr.join(Arr.map(lines, String), "\n");

const parse = (argv: ReadonlyArray<string>) => Args.parse(argv).pipe(Effect.provide(NodeServices.layer));

const usageError = Effect.fnUntraced(function* (argv: ReadonlyArray<string>) {
    const error = yield* Effect.flip(parse(argv));
    return {
        error,
        stdout: yield* TestConsole.logLines,
        stderr: text(yield* TestConsole.errorLines),
    };
});

describe("Args.parse", () => {
    it.effect("resolves the file against the working directory and follows it by default", () =>
        Effect.gen(function* () {
            expect(yield* parse(["spans.jsonl"])).toEqual(
                Option.some({
                    file: resolve("spans.jsonl"),
                    follow: true,
                    run: Option.none(),
                    trace: Option.none(),
                }),
            );
        }),
    );

    it.effect("reads --no-follow as follow: false and keeps an absolute file as given", () =>
        Effect.gen(function* () {
            expect(yield* parse(["--no-follow", "/var/log/app/spans.jsonl"])).toEqual(
                Option.some({
                    file: "/var/log/app/spans.jsonl",
                    follow: false,
                    run: Option.none(),
                    trace: Option.none(),
                }),
            );
        }),
    );

    it.effect("passes --run and --trace through as given", () =>
        Effect.gen(function* () {
            expect(yield* parse(["../out/spans.jsonl", "--run", "2026-10-07T10-01", "--trace", "9f3c"])).toEqual(
                Option.some({
                    file: resolve("../out/spans.jsonl"),
                    follow: true,
                    run: Option.some("2026-10-07T10-01"),
                    trace: Option.some("9f3c"),
                }),
            );
        }),
    );

    it.effect("fails with a usage error, usage on stderr, when no file is given", () =>
        Effect.gen(function* () {
            const { error, stdout, stderr } = yield* usageError([]);
            expect(error).toBeInstanceOf(Args.UsageError);
            expect(stdout).toEqual([]);
            expect(stderr).toContain("USAGE\n  otelscope [flags] <file>");
            expect(stderr).toContain("Missing required argument: file");
        }),
    );

    it.effect("fails with a usage error on an unknown flag", () =>
        Effect.gen(function* () {
            const { error, stdout, stderr } = yield* usageError(["spans.jsonl", "--bogus"]);
            expect(error).toBeInstanceOf(Args.UsageError);
            expect(stdout).toEqual([]);
            expect(stderr).toContain("USAGE\n  otelscope [flags] <file>");
            expect(stderr).toContain("Unrecognized flag: --bogus");
        }),
    );

    it.effect("fails with a usage error when a flag is missing its value", () =>
        Effect.gen(function* () {
            const { error, stdout, stderr } = yield* usageError(["spans.jsonl", "--run"]);
            expect(error).toBeInstanceOf(Args.UsageError);
            expect(stdout).toEqual([]);
            expect(stderr).toContain("Missing value for flag --run");
        }),
    );

    it.effect("prints the package version for --version and parses nothing", () =>
        Effect.gen(function* () {
            const { version } = yield* Schema.decodeUnknownEffect(PackageJson)(
                readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
            );
            expect(yield* parse(["--version"])).toEqual(Option.none());
            expect(yield* TestConsole.logLines).toEqual([`otelscope ${version}`]);
            expect(yield* TestConsole.errorLines).toEqual([]);
        }),
    );

    it.effect("prints help to stdout with only the help and version built-ins", () =>
        Effect.gen(function* () {
            expect(yield* parse(["--help"])).toEqual(Option.none());
            const help = text(yield* TestConsole.logLines);
            expect(help).toContain("USAGE\n  otelscope [flags] <file>");
            expect(help).toContain("--no-follow");
            expect(help).toContain("--version");
            expect(help).not.toContain("--wizard");
            expect(help).not.toContain("--completions");
            expect(help).not.toContain("--log-level");
            expect(yield* TestConsole.errorLines).toEqual([]);
        }),
    );
});
