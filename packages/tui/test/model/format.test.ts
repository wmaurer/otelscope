import { describe, expect, it } from "@effect/vitest";

import {
    basename,
    clockTime,
    count,
    duration,
    lastSegments,
    offset,
    plural,
    runLabel,
    serviceName,
    shortId,
    size,
    sizePair,
    started,
} from "../../src/model/format.ts";

const at = (iso: string) => Date.parse(iso);

describe("format", () => {
    it("formats durations by the tier table, carrying a rounded value into the next tier", () => {
        expect(duration(0.347)).toBe("347µs");
        expect(duration(2.364)).toBe("2.36ms");
        expect(duration(23.54)).toBe("23.5ms");
        expect(duration(235.4)).toBe("235ms");
        expect(duration(2354)).toBe("2.35s");
        expect(duration(23_540)).toBe("23.5s");
        expect(duration(123_000)).toBe("2m 03s");
        expect(duration(3_720_000)).toBe("1h 02m");
        expect(duration(0.9996)).toBe("1.00ms");
        expect(duration(9.996)).toBe("10.0ms");
        expect(duration(99.96)).toBe("100ms");
        expect(duration(999.6)).toBe("1.00s");
        expect(duration(59_960)).toBe("1m 00s");
        expect(duration(3_599_600)).toBe("1h 00m");
        expect(duration(1240, true)).toBe("1.24s…");
        expect(offset(245.1)).toBe("+245ms");
    });

    it("prints local clock times", () => {
        expect(clockTime(at("2026-10-06T14:03:27.315Z"))).toBe("14:03:27");
        expect(clockTime(at("2026-10-06T14:03:27.315Z"), "millis")).toBe("14:03:27.315");
        expect(clockTime(at("2026-10-06T04:05:06.007Z"), "millis")).toBe("04:05:06.007");
    });

    it("words a start time relative to now", () => {
        const now = at("2026-10-07T09:00:00Z");
        expect(started(at("2026-10-07T00:00:01Z"), now)).toBe("00:00:01");
        expect(started(at("2026-10-06T23:59:00Z"), now)).toBe("yest 23:59");
        expect(started(at("2026-10-06T14:03:27Z"), now)).toBe("yest 14:03");
        expect(started(at("2026-10-05T14:03:27Z"), now)).toBe("Mon 14:03");
        expect(started(at("2026-10-01T14:03:27Z"), now)).toBe("Thu 14:03");
        expect(started(at("2026-09-30T14:03:27Z"), now)).toBe("2026-09-30 14:03");
    });

    it("labels a run by service and start", () => {
        const now = at("2026-10-06T15:00:00Z");
        expect(runLabel({ service: "shop-api", firstStartMs: at("2026-10-06T14:03:27Z") }, now)).toBe(
            "shop-api · 14:03:27",
        );
        expect(runLabel({ service: "", firstStartMs: at("2026-10-06T14:03:27Z") }, now)).toBe("(unnamed) · 14:03:27");
        expect(serviceName("api")).toBe("api");
    });

    it("groups thousands with commas and pluralises counts", () => {
        expect(count(0)).toBe("0");
        expect(count(999)).toBe("999");
        expect(count(12_480)).toBe("12,480");
        expect(count(1_234_567)).toBe("1,234,567");
        expect(plural(1, "run")).toBe("1 run");
        expect(plural(12_480, "span")).toBe("12,480 spans");
        expect(plural(0, "span")).toBe("0 spans");
    });

    it("prints sizes in decimal units with one decimal", () => {
        expect(size(812)).toBe("812 B");
        expect(size(12_400)).toBe("12.4 KB");
        expect(size(3_400_000)).toBe("3.4 MB");
        expect(size(999_960)).toBe("1.0 MB");
        expect(sizePair(41_000_000, 96_000_000)).toBe("41 / 96 MB");
        expect(sizePair(1_500_000, 3_400_000)).toBe("1.5 / 3.4 MB");
        expect(sizePair(1_500_000, 34_000_000)).toBe("1.5 / 34 MB");
        expect(sizePair(300, 900)).toBe("300 / 900 B");
    });

    it("shortens ids and paths", () => {
        expect(shortId("5643b831aa22bb33")).toBe("5643b831");
        expect(shortId("9f3c")).toBe("9f3c");
        expect(lastSegments("/home/me/project/fixture/scenarios.ts")).toBe("fixture/scenarios.ts");
        expect(lastSegments("scenarios.ts")).toBe("scenarios.ts");
        expect(basename("/tmp/run/spans.jsonl")).toBe("spans.jsonl");
    });
});
