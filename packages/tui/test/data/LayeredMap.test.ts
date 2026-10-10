import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Schema } from "effect";

import { LayeredMap } from "../../src/data/LayeredMap.ts";

const Publishes = Schema.Array(
    Schema.Array(Schema.Tuple([Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 })), Schema.String])),
).check(Schema.isMaxLength(30));

describe("LayeredMap", () => {
    it.prop(
        "holds what a Map would after the same publishes, in a Map's order, and leaves earlier versions as they were",
        [Publishes],
        ([publishes]) => {
            const versions = Arr.scan(publishes, LayeredMap.empty<number, string>(), (map, updates) =>
                map.with(updates),
            );
            // A Map built from entries sets them in turn, as a publish does.
            const plain = Arr.scan(
                publishes,
                new Map<number, string>(),
                (map, updates) => new Map([...map, ...updates]),
            );
            Arr.forEach(Arr.zip(versions, plain), ([layered, expected]) => {
                expect(Array.from(layered.entries())).toEqual(Array.from(expected.entries()));
                expect(layered.size).toBe(expected.size);
                Arr.forEach(Arr.range(0, 41), (key) => {
                    expect(layered.get(key)).toBe(expected.get(key));
                    expect(layered.has(key)).toBe(expected.has(key));
                });
            });
        },
    );
});
