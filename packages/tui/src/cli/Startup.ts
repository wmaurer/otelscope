import { Effect, FileSystem, Option, Path, type PlatformError, Schema } from "effect";

import type { CliArgs } from "./Args.ts";

export class NoSuchDirectory extends Schema.TaggedError<NoSuchDirectory>()("NoSuchDirectory", {
    dir: Schema.String,
}) {
    override get message() {
        return `no such directory: ${this.dir}`;
    }
}

export class IsDirectory extends Schema.TaggedError<IsDirectory>()("IsDirectory", { path: Schema.String }) {
    override get message() {
        return `is a directory: ${this.path}`;
    }
}

export class NoSuchFile extends Schema.TaggedError<NoSuchFile>()("NoSuchFile", { path: Schema.String }) {
    override get message() {
        return `no such file: ${this.path}`;
    }
}

export class CannotRead extends Schema.TaggedError<CannotRead>()("CannotRead", {
    path: Schema.String,
    reason: Schema.String,
}) {
    override get message() {
        return `cannot read ${this.path}: ${this.reason}`;
    }
}

export class NotATty extends Schema.TaggedError<NotATty>()("NotATty", {}) {
    override get message() {
        return "needs an interactive terminal";
    }
}

export type StartupError = NoSuchDirectory | IsDirectory | NoSuchFile | CannotRead | NotATty;

export interface TtyState {
    readonly stdin: boolean;
    readonly stdout: boolean;
}

const systemReasons = {
    AlreadyExists: "already exists",
    BadResource: "not a regular file or directory",
    Busy: "resource busy",
    InvalidData: "invalid data",
    NotFound: "no such file or directory",
    PermissionDenied: "permission denied",
    TimedOut: "timed out",
    UnexpectedEof: "unexpected end of file",
    Unknown: "unknown error",
    WouldBlock: "operation would block",
    WriteZero: "write returned zero bytes",
} satisfies Record<PlatformError.SystemErrorTag, string>;

const reasonOf = ({ reason }: PlatformError.PlatformError): string =>
    reason._tag === "BadArgument" ? (reason.description ?? reason.message) : systemReasons[reason._tag];

const statIfExists = (fs: FileSystem.FileSystem, path: string) =>
    fs.stat(path).pipe(
        Effect.asSome,
        Effect.catchIf(
            ({ reason }) => reason._tag === "NotFound",
            () => Effect.succeedNone,
        ),
    );

/** Fails with the first failing check in the order the CLI spec lists them; the terminal check is last. */
export const check = Effect.fnUntraced(function* (args: CliArgs, tty: TtyState) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cannotRead = (error: PlatformError.PlatformError) =>
        new CannotRead({ path: args.file, reason: reasonOf(error) });

    const dir = path.dirname(args.file);
    const dirInfo = yield* statIfExists(fs, dir).pipe(Effect.mapError(cannotRead));
    if (Option.isNone(dirInfo) || dirInfo.value.type !== "Directory") {
        return yield* new NoSuchDirectory({ dir });
    }

    const fileInfo = yield* statIfExists(fs, args.file).pipe(Effect.mapError(cannotRead));
    if (Option.isSome(fileInfo)) {
        if (fileInfo.value.type === "Directory") {
            return yield* new IsDirectory({ path: args.file });
        }
        yield* fs.access(args.file, { readable: true }).pipe(Effect.mapError(cannotRead));
    } else if (!args.follow) {
        return yield* new NoSuchFile({ path: args.file });
    }

    if (!tty.stdin || !tty.stdout) {
        return yield* new NotATty();
    }
});
