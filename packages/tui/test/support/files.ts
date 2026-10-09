import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempDir = (): string => mkdtempSync(join(tmpdir(), "otelscope-tui-"));

export const tempFile = (): string => join(tempDir(), "spans.jsonl");

export const utf8Length = (text: string): number => new TextEncoder().encode(text).length;
