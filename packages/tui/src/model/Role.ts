export type Role =
    | "text"
    | "muted"
    | "faint"
    | "accent"
    | "focusBorder"
    | "selectionBg"
    | "matchBg"
    | "bar"
    | "failure"
    | "failurePropagated"
    | "interrupted"
    | "live"
    | "warning"
    | "logTrace"
    | "logDebug"
    | "logInfo"
    | "logWarn"
    | "logError"
    | "logFatal"
    | "jsonKey"
    | "jsonString"
    | "jsonNumber"
    | "jsonLiteral"
    | "overlayBg";

export interface Chunk {
    readonly text: string;
    readonly role: Role;
    readonly bold?: boolean;
}

export type Line = ReadonlyArray<Chunk>;

export const chunk = (text: string, role: Role, bold = false): Chunk => (bold ? { text, role, bold } : { text, role });
