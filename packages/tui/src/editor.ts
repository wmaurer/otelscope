import { Array as Arr, Effect, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

export interface EditTarget {
    readonly file: string;
    readonly line: Option.Option<number>;
    readonly col: Option.Option<number>;
}

export interface Invocation {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
}

/** The span's `def` when it has one, else its `site`. */
export const locationTarget = (span: JsonlSpanRecord): Option.Option<EditTarget> =>
    Option.map(Option.fromNullishOr(span.def ?? span.site), (location) => ({
        file: location.file,
        line: Option.some(location.line),
        col: Option.some(location.col),
    }));

const GOTO_EDITORS: ReadonlySet<string> = new Set(["code", "cursor", "codium"]);

const isAbsolute = (file: string): boolean => file.startsWith("/");

/**
 * `$VISUAL`, else `$EDITOR`, split on spaces. `code`, `cursor` and `codium` take `--goto file:line:col`; every other
 * editor takes `+line file`. A relative file is resolved against `cwd`. None when no editor is set.
 */
export const invocation = (
    env: { readonly VISUAL?: string | undefined; readonly EDITOR?: string | undefined },
    cwd: string,
    target: EditTarget,
): Option.Option<Invocation> => {
    const words = Arr.filter((env.VISUAL || env.EDITOR || "").split(" "), (word) => word !== "");
    if (!Arr.isReadonlyArrayNonEmpty(words)) {
        return Option.none();
    }
    const [command, ...flags] = words;
    const file = isAbsolute(target.file) ? target.file : `${cwd.replace(/\/$/, "")}/${target.file}`;
    const base = Option.getOrElse(Arr.last(command.split("/")), () => command);
    const location = Option.match(target.line, {
        onNone: (): ReadonlyArray<string> => [file],
        onSome: (line) =>
            GOTO_EDITORS.has(base)
                ? [
                      "--goto",
                      `${file}:${line}${Option.match(target.col, { onNone: () => "", onSome: (col) => `:${col}` })}`,
                  ]
                : [`+${line}`, file],
    });
    return Option.some({ command, args: [...flags, ...location] });
};

export const NO_EDITOR = "set $VISUAL or $EDITOR to open files";

/**
 * Runs the editor in the foreground with the renderer suspended, and resumes it whatever the editor's exit. Succeeds
 * with a status message when nothing could run.
 */
export const openEditor = Effect.fnUntraced(function* (
    found: Option.Option<Invocation>,
    renderer: { readonly suspend: () => void; readonly resume: () => void },
) {
    if (Option.isNone(found)) {
        return Option.some(NO_EDITOR);
    }
    const { command, args } = found.value;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // Not detached: a child in its own process group could not read the terminal.
    const run = spawner.exitCode(
        ChildProcess.make(command, args, { stdin: "inherit", stdout: "inherit", stderr: "inherit", detached: false }),
    );
    return yield* Effect.acquireUseRelease(
        Effect.sync(() => renderer.suspend()),
        () =>
            Effect.match(run, {
                onFailure: () => Option.some(`could not run ${command}`),
                onSuccess: () => Option.none<string>(),
            }),
        () => Effect.sync(() => renderer.resume()),
    );
});
