import { Console, Effect, Exit, Option, Path, Ref, Runtime, Schema } from "effect";
import { Argument, CliConfig, CliOutput, Command, Flag, GlobalFlag } from "effect/cli";
import { TestConsole } from "effect/testing";

const version = "0.1.0";

export interface CliArgs {
    /** Absolute. */
    readonly file: string;
    readonly follow: boolean;
    readonly run: Option.Option<string>;
    readonly trace: Option.Option<string>;
}

/** The usage has already been printed to stderr when this fails. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {}) {
    override readonly [Runtime.errorExitCode] = 2;
}

const command = (onArgs: (args: CliArgs) => Effect.Effect<void>) =>
    Command.make(
        "otelscope",
        {
            file: Argument.String("file").pipe(Argument.withDescription("The JSONL file that JsonlTrace.layer writes")),
            noFollow: Flag.Boolean("no-follow").pipe(
                Flag.withDescription("Read the file once instead of following it"),
                Flag.withDefault(false),
            ),
            run: Flag.String("run").pipe(
                Flag.withDescription("Open this run: its id, or a unique prefix of it"),
                Flag.optional,
            ),
            trace: Flag.String("trace").pipe(
                Flag.withDescription("Open this trace: its id, or a unique prefix of it"),
                Flag.optional,
            ),
        },
        Effect.fnUntraced(function* (raw) {
            const path = yield* Path.Path;
            yield* onArgs({ file: path.resolve(raw.file), follow: !raw.noFollow, run: raw.run, trace: raw.trace });
        }),
    ).pipe(Command.withDescription("A terminal viewer for otelscope JSONL span files."));

const cliConfig = CliConfig.make({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] });

const formatter = (): CliOutput.Formatter => {
    const base = CliOutput.defaultFormatter();
    return {
        formatHelpDoc: base.formatHelpDoc,
        formatCliError: base.formatCliError,
        formatError: base.formatError,
        formatErrors: base.formatErrors,
        formatVersion: (name, v) => `${name} ${v}`,
    };
};

/**
 * Parses argv into `CliArgs`, or `None` when `--help` or `--version` has printed its answer to stdout.
 *
 * effect/cli prints the usage for a usage error to stdout and the errors to stderr. `TestConsole` is used here as a
 * recorder: it holds back everything effect/cli writes, and on a usage error all of it goes to stderr, usage first,
 * the order effect/cli writes it in.
 */
export const parse = Effect.fnUntraced(function* (argv: ReadonlyArray<string>) {
    const parsed = yield* Ref.make(Option.none<CliArgs>());
    const run = Command.runWith(
        command((args) => Ref.set(parsed, Option.some(args))),
        { version },
    );
    const recorder = yield* TestConsole.make;
    const replay = Effect.fnUntraced(function* (usageError: boolean) {
        const logLine = usageError ? Console.error : Console.log;
        yield* Effect.forEach(yield* recorder.logLines, (line) => logLine(line), { discard: true });
        yield* Effect.forEach(yield* recorder.errorLines, (line) => Console.error(line), { discard: true });
    });

    yield* run(argv).pipe(
        Effect.provideService(Console.Console, recorder),
        Effect.provideService(CliConfig.CliConfig, cliConfig),
        Effect.provideService(CliOutput.Formatter, formatter()),
        Effect.onExit((exit) => replay(Exit.isFailure(exit))),
        Effect.mapError(() => new UsageError()),
    );
    return yield* Ref.get(parsed);
});
