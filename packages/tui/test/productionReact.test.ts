// @effect-diagnostics processEnvInEffect:off
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { withProductionReact } from "../src/productionReact.ts";

const nodeEnv = Effect.sync(() => process.env.NODE_ENV);
const isSet = () => Object.hasOwn(process.env, "NODE_ENV");

describe("withProductionReact", () => {
    const given = process.env.NODE_ENV;
    beforeEach(() => {
        Reflect.deleteProperty(process.env, "NODE_ENV");
    });
    afterEach(() => {
        process.env.NODE_ENV = given;
    });

    it.effect("loads under NODE_ENV=production and leaves it unset after, as the user had it", () =>
        Effect.gen(function* () {
            expect(yield* withProductionReact(nodeEnv)).toBe("production");
            expect(isSet()).toBe(false);
        }),
    );

    it.effect("leaves it unset after a load that fails", () =>
        Effect.gen(function* () {
            const exit = yield* Effect.exit(withProductionReact(Effect.fail("no app")));
            expect(exit).toEqual(Exit.fail("no app"));
            expect(isSet()).toBe(false);
        }),
    );

    it.effect("keeps the user's own NODE_ENV", () =>
        Effect.gen(function* () {
            process.env.NODE_ENV = "development";
            expect(yield* withProductionReact(nodeEnv)).toBe("development");
            expect(process.env.NODE_ENV).toBe("development");
        }),
    );
});
