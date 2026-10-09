import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { Bodies, BodyMissing, BodyReadFailed } from "../../src/data/Bodies.ts";
import { InputFile } from "../../src/data/InputFile.ts";
import { tempDir } from "../support/files.ts";

const sha = (letter: string) => letter.repeat(64);

const bodiesDir = (bodies: Readonly<Record<string, string>>) => {
    const dir = tempDir();
    const folder = join(dir, "bodies");
    mkdirSync(folder);
    for (const [hash, text] of Object.entries(bodies)) {
        writeFileSync(join(folder, `${hash}.txt`), text);
    }
    return { file: join(dir, "spans.jsonl"), bodies: folder };
};

const withBodies = (file: string, maxCacheBytes?: number) =>
    Effect.provide(
        Effect.service(Bodies),
        (maxCacheBytes === undefined ? Bodies.layer : Bodies.layerWithCache(maxCacheBytes)).pipe(
            Layer.provide(InputFile.layer({ file, follow: false })),
            Layer.provide(NodeServices.layer),
        ),
    );

describe("Bodies", () => {
    it.effect("reads a body whole, with its declared length", () =>
        Effect.gen(function* () {
            const { file } = bodiesDir({ [sha("a")]: "héllo" });
            const bodies = yield* withBodies(file);
            expect(yield* bodies.read(sha("a"), 6)).toEqual({ text: "héllo", truncated: false, bytes: 6 });
        }),
    );

    it.effect("marks a body truncated when the declared bytes exceed the stored file", () =>
        Effect.gen(function* () {
            const { file } = bodiesDir({ [sha("a")]: "capped\ntruncated 10 chars" });
            const bodies = yield* withBodies(file);
            expect(yield* bodies.read(sha("a"), 5_000)).toEqual({
                text: "capped\ntruncated 10 chars",
                truncated: true,
                bytes: 5_000,
            });
        }),
    );

    it.effect("fails with BodyMissing when the file does not exist", () =>
        Effect.gen(function* () {
            const { file, bodies: dir } = bodiesDir({});
            const bodies = yield* withBodies(file);
            expect(yield* Effect.flip(bodies.read(sha("b"), 1))).toEqual(
                new BodyMissing({ sha256: sha("b"), path: join(dir, `${sha("b")}.txt`) }),
            );
        }),
    );

    it.effect("fails with BodyReadFailed when the file cannot be read", () =>
        Effect.gen(function* () {
            const { file, bodies: dir } = bodiesDir({});
            mkdirSync(join(dir, `${sha("c")}.txt`));
            const bodies = yield* withBodies(file);
            const error = yield* Effect.flip(bodies.read(sha("c"), 1));
            expect(error).toBeInstanceOf(BodyReadFailed);
            expect(error).toMatchObject({ sha256: sha("c"), path: join(dir, `${sha("c")}.txt`) });
        }),
    );

    it.effect("evicts the least recently read bodies once the cache holds more bytes than its limit", () =>
        Effect.gen(function* () {
            const { file, bodies: dir } = bodiesDir({
                [sha("a")]: "aaaaaa",
                [sha("b")]: "bbbbbb",
                [sha("c")]: "cccccc",
            });
            const bodies = yield* withBodies(file, 12);
            yield* bodies.read(sha("a"), 6);
            yield* bodies.read(sha("b"), 6);
            yield* bodies.read(sha("a"), 6);
            yield* bodies.read(sha("c"), 6);
            rmSync(dir, { recursive: true });

            expect((yield* bodies.read(sha("a"), 6)).text, "recently read, still cached").toBe("aaaaaa");
            expect((yield* bodies.read(sha("c"), 6)).text, "just read, still cached").toBe("cccccc");
            expect((yield* Effect.flip(bodies.read(sha("b"), 6)))._tag, "least recently read, evicted").toBe(
                "BodyMissing",
            );
        }),
    );

    it.effect("stats the stored file, reading a missing file or a stat error as None", () =>
        Effect.gen(function* () {
            const { file } = bodiesDir({ [sha("a")]: "héllo" });
            const bodies = yield* withBodies(file);
            expect(yield* bodies.stat(sha("a"))).toEqual(Option.some(6));
            expect(yield* bodies.stat(sha("b"))).toEqual(Option.none());

            const notADirectory = tempDir();
            writeFileSync(join(notADirectory, "bodies"), "");
            const broken = yield* withBodies(join(notADirectory, "spans.jsonl"));
            expect(yield* broken.stat(sha("a")), "bodies/ is a file").toEqual(Option.none());
        }),
    );
});
