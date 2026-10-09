import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";

import { InputFile } from "./InputFile.ts";

export interface BodyText {
    readonly text: string;
    readonly truncated: boolean;
    readonly bytes: number;
}

export class BodyMissing extends Schema.TaggedError<BodyMissing>()("BodyMissing", {
    sha256: Schema.String,
    path: Schema.String,
}) {}

export class BodyReadFailed extends Schema.TaggedError<BodyReadFailed>()("BodyReadFailed", {
    sha256: Schema.String,
    path: Schema.String,
    message: Schema.String,
}) {}

export const MAX_CACHE_BYTES = 32 * 1024 * 1024;

interface Stored {
    readonly text: string;
    readonly fileBytes: number;
}

class ByteBoundedLru {
    private readonly entries = new Map<string, Stored>();
    private readonly maxBytes: number;
    private total = 0;

    constructor(maxBytes: number) {
        this.maxBytes = maxBytes;
    }

    get(sha256: string): Stored | undefined {
        const stored = this.entries.get(sha256);
        if (stored !== undefined) {
            this.entries.delete(sha256);
            this.entries.set(sha256, stored);
        }
        return stored;
    }

    set(sha256: string, stored: Stored): void {
        if (this.entries.has(sha256)) {
            return;
        }
        this.entries.set(sha256, stored);
        this.total += stored.fileBytes;
        for (const [oldest, evicted] of this.entries) {
            if (this.total <= this.maxBytes || oldest === sha256) {
                return;
            }
            this.entries.delete(oldest);
            this.total -= evicted.fileBytes;
        }
    }
}

const utf8 = new TextDecoder();

export class Bodies extends Context.Service<
    Bodies,
    {
        read(sha256: string, declaredBytes: number): Effect.Effect<BodyText, BodyMissing | BodyReadFailed>;
        stat(sha256: string): Effect.Effect<Option.Option<number>>;
    }
>()("@wmaurer/otelscope/data/Bodies") {
    static readonly layerWithCache = (maxCacheBytes: number) =>
        Layer.effect(
            Bodies,
            Effect.gen(function* () {
                const input = yield* InputFile;
                const fs = yield* FileSystem.FileSystem;
                const path = yield* Path.Path;
                const cache = new ByteBoundedLru(maxCacheBytes);
                const pathOf = (sha256: string) => path.join(input.bodiesDir, `${sha256}.txt`);

                const load = (sha256: string) => {
                    const file = pathOf(sha256);
                    return fs.readFile(file).pipe(
                        Effect.map((data): Stored => ({ text: utf8.decode(data), fileBytes: data.length })),
                        Effect.tap((stored) => Effect.sync(() => cache.set(sha256, stored))),
                        Effect.mapError((error) =>
                            error.reason._tag === "NotFound"
                                ? new BodyMissing({ sha256, path: file })
                                : new BodyReadFailed({ sha256, path: file, message: error.message }),
                        ),
                    );
                };

                return Bodies.of({
                    read: Effect.fnUntraced(function* (sha256: string, declaredBytes: number) {
                        const stored = cache.get(sha256) ?? (yield* load(sha256));
                        return { text: stored.text, truncated: declaredBytes > stored.fileBytes, bytes: declaredBytes };
                    }),
                    stat: (sha256) =>
                        fs.stat(pathOf(sha256)).pipe(
                            Effect.map((info) => Option.some(Number(info.size))),
                            Effect.orElseSucceed(() => Option.none()),
                        ),
                });
            }),
        );

    static readonly layer = Bodies.layerWithCache(MAX_CACHE_BYTES);
}
