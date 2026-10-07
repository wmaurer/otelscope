import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { PREVIEW_CHARS, slimSpan } from "../src/Bodies.ts";
import { plainAttributes } from "../src/Jsonl.ts";
import { otlpSpan, str } from "./support/spans.ts";

describe("slimSpan", () => {
    it.effect("replaces a .body attribute with its hash, size and preview, and returns the body", () =>
        Effect.gen(function* () {
            const { span, bodies } = yield* slimSpan(
                otlpSpan({
                    name: "agent.match",
                    spanId: "s1",
                    attributes: [str("prompt.body", "hello world"), str("ticket.key", "PROJ-412")],
                }),
            );

            const attrs = plainAttributes(span.attributes);
            assert.match(String(attrs["prompt.sha256"]), /^[0-9a-f]{64}$/);
            assert.strictEqual(attrs["prompt.bytes"], 11);
            assert.strictEqual(attrs["prompt.preview"], "hello world");
            assert.strictEqual(attrs["ticket.key"], "PROJ-412");
            assert.isFalse("prompt.body" in attrs);
            assert.deepStrictEqual(bodies, [{ sha256: String(attrs["prompt.sha256"]), text: "hello world" }]);
        }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("caps the preview but reports the full UTF-8 byte length", () =>
        Effect.gen(function* () {
            const { span } = yield* slimSpan(
                otlpSpan({ name: "s", spanId: "s1", attributes: [str("response.body", "€".repeat(500))] }),
            );

            const attrs = plainAttributes(span.attributes);
            assert.lengthOf(String(attrs["response.preview"]), PREVIEW_CHARS);
            assert.strictEqual(attrs["response.bytes"], 1500);
        }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("truncates a body past the cap and says so in the stored text", () =>
        Effect.gen(function* () {
            const { span, bodies } = yield* slimSpan(
                otlpSpan({ name: "s", spanId: "s1", attributes: [str("prompt.body", "y".repeat(250))] }),
                100,
            );

            assert.strictEqual(bodies[0]?.text, `${"y".repeat(100)}\ntruncated 150 chars`);
            assert.strictEqual(plainAttributes(span.attributes)["prompt.bytes"], 250);
        }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("leaves a span without a .body attribute unchanged", () =>
        Effect.gen(function* () {
            const original = otlpSpan({ name: "s", spanId: "s1", attributes: [str("ticket.key", "PROJ-412")] });
            const { span, bodies } = yield* slimSpan(original);

            assert.deepStrictEqual(span, original);
            assert.lengthOf(bodies, 0);
        }).pipe(Effect.provide(NodeServices.layer)),
    );
});
