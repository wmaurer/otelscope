import { Array as Arr, Option, Predicate } from "effect";

import type { Role } from "./Role.ts";
import type { Attributes } from "@wmaurer/otelscope-effect/format";

/** Effect's log levels as a log event records them, least severe first. */
export const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;

export type LogLevel = (typeof LEVELS)[number];

const LOG_LEVEL = "effect.logLevel";

const isLevel = (value: string): value is LogLevel => Arr.contains(LEVELS, value);

/** The level of a log event, None for any other event. */
export const levelOf = (attrs: Attributes): Option.Option<LogLevel> => {
    const value = attrs[LOG_LEVEL];
    return Predicate.isString(value) && isLevel(value) ? Option.some(value) : Option.none();
};

export const severity = (level: LogLevel): number =>
    Arr.findFirstIndex(LEVELS, (l) => l === level).pipe(Option.getOrElse(() => 0));

export const levelRole = {
    TRACE: "logTrace",
    DEBUG: "logDebug",
    INFO: "logInfo",
    WARN: "logWarn",
    ERROR: "logError",
    FATAL: "logFatal",
} satisfies Readonly<Record<LogLevel, Role>>;
