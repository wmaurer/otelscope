import type { Role } from "../model/Role.ts";

export type Theme = Readonly<Record<Role, string>>;

export const theme = {
    text: "#d4d4d4",
    muted: "#7f848e",
    faint: "#4b5263",
    accent: "#61afef",
    focusBorder: "#61afef",
    selectionBg: "#2c323c",
    matchBg: "#4d4220",
    bar: "#56b6c2",
    failure: "#ff5f5f",
    failurePropagated: "#a14848",
    interrupted: "#e5a50a",
    live: "#98c379",
    warning: "#e5c07b",
    logTrace: "#5c6370",
    logDebug: "#7f848e",
    logInfo: "#61afef",
    logWarn: "#e5c07b",
    logError: "#ff5f5f",
    logFatal: "#ff5f5f",
    jsonKey: "#61afef",
    jsonString: "#98c379",
    jsonNumber: "#d19a66",
    jsonLiteral: "#c678dd",
    overlayBg: "#21252b",
} satisfies Theme;
