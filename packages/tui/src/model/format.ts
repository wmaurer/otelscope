import { Array as Arr, DateTime, Option } from "effect";

import type { Run } from "../data/Snapshot.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The first tier whose rounded value stays under its bound, so 9.996ms reads `10.0ms`, not `10.00ms`. */
const tiers: ReadonlyArray<(ms: number) => Option.Option<string>> = [
    (ms) => {
        const us = Math.round(ms * 1000);
        return us < 1000 ? Option.some(`${us}µs`) : Option.none();
    },
    (ms) => (Number(ms.toFixed(2)) < 10 ? Option.some(`${ms.toFixed(2)}ms`) : Option.none()),
    (ms) => (Number(ms.toFixed(1)) < 100 ? Option.some(`${ms.toFixed(1)}ms`) : Option.none()),
    (ms) => (Math.round(ms) < SECOND ? Option.some(`${Math.round(ms)}ms`) : Option.none()),
    (ms) => {
        const s = (ms / SECOND).toFixed(2);
        return Number(s) < 10 ? Option.some(`${s}s`) : Option.none();
    },
    (ms) => {
        const s = (ms / SECOND).toFixed(1);
        return Number(s) < 60 ? Option.some(`${s}s`) : Option.none();
    },
    (ms) => {
        const s = Math.round(ms / SECOND);
        return s < 3600 ? Option.some(`${Math.floor(s / 60)}m ${pad(s % 60)}s`) : Option.none();
    },
];

export const duration = (ms: number, running = false): string => {
    const value = Math.max(0, ms);
    const text = Option.getOrElse(
        Arr.findFirst(tiers, (tier) => tier(value)),
        () => {
            const minutes = Math.round(value / MINUTE);
            return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
        },
    );
    return running ? `${text}…` : text;
};

export const offset = (ms: number): string => `+${duration(ms)}`;

const localZone = DateTime.zoneMakeLocal();

const local = (epochMs: number): DateTime.Zoned => DateTime.makeZonedUnsafe(epochMs, { timeZone: localZone });

export const clockTime = (epochMs: number, precision: "seconds" | "millis" = "seconds"): string => {
    const parts = DateTime.toParts(local(epochMs));
    const seconds = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
    return precision === "millis" ? `${seconds}.${pad(parts.millisecond, 3)}` : seconds;
};

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const started = (epochMs: number, now: number): string => {
    const at = local(epochMs);
    const days = Math.round(
        (DateTime.toEpochMillis(DateTime.startOf(local(now), "day")) -
            DateTime.toEpochMillis(DateTime.startOf(at, "day"))) /
            DAY,
    );
    const parts = DateTime.toParts(at);
    const hm = `${pad(parts.hour)}:${pad(parts.minute)}`;
    if (days <= 0) {
        return clockTime(epochMs);
    }
    if (days === 1) {
        return `yest ${hm}`;
    }
    if (days <= 6) {
        return `${weekDays[parts.weekDay] ?? ""} ${hm}`;
    }
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${hm}`;
};

export const serviceName = (service: string): string => (service === "" ? "(unnamed)" : service);

export const runLabel = (run: Pick<Run, "service" | "firstStartMs">, now: number): string =>
    `${serviceName(run.service)} · ${started(run.firstStartMs, now)}`;

export const count = (n: number): string => {
    const digits = String(Math.trunc(Math.abs(n)));
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return n < 0 ? `-${grouped}` : grouped;
};

export const plural = (n: number, noun: string): string => `${count(n)} ${noun}${n === 1 ? "" : "s"}`;

const units = ["B", "KB", "MB", "GB", "TB"];

const unitOf = (bytes: number): number => {
    const exponent = bytes < 1000 ? 0 : Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
    return Number((bytes / 1000 ** exponent).toFixed(1)) >= 1000 ? Math.min(units.length - 1, exponent + 1) : exponent;
};

const inUnit = (bytes: number, exponent: number, decimals: number): string =>
    exponent === 0 ? String(Math.round(bytes)) : (bytes / 1000 ** exponent).toFixed(decimals);

export const size = (bytes: number): string => {
    const exponent = unitOf(bytes);
    return `${inUnit(bytes, exponent, 1)} ${units[exponent] ?? ""}`;
};

export const sizePair = (done: number, total: number): string => {
    const exponent = unitOf(total);
    const part = (bytes: number) => {
        const value = bytes / 1000 ** exponent;
        return inUnit(bytes, exponent, value < 9.95 ? 1 : 0);
    };
    return `${part(done)} / ${part(total)} ${units[exponent] ?? ""}`;
};

export const shortId = (id: string): string => id.slice(0, 8);

const segments = (path: string): ReadonlyArray<string> => Arr.filter(path.split(/[\\/]/), (s) => s !== "");

export const lastSegments = (path: string): string => Arr.join(Arr.takeRight(segments(path), 2), "/");

export const basename = (path: string): string => Option.getOrElse(Arr.last(segments(path)), () => path);
