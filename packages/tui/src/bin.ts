#!/usr/bin/env node
// No imports, and only syntax that old Node parses, so the version guard can speak before anything fails. Effect is
// not loaded yet, so the environment is read directly rather than through `Config`.
// @effect-diagnostics processEnv:off

if (process.versions.bun === undefined && process.getBuiltinModule?.("node:ffi") === undefined) {
    process.stderr.write(
        `otelscope needs Node >= 26.9 (found ${process.version}). On Node 26.1–26.8, run it with --experimental-ffi.\n`,
    );
    process.exit(1);
}

if (process.platform === "linux" && process.env.OPENTUI_LIBC === undefined) {
    // SAFETY: Node writes `header.glibcVersionRuntime` into every diagnostic report on glibc and leaves it out on
    // musl; @types/node types the whole report as `object`.
    const report = process.report.getReport() as { readonly header: { readonly glibcVersionRuntime?: string } };
    if (report.header.glibcVersionRuntime === undefined) {
        process.env.OPENTUI_LIBC = "musl";
    }
}

// Delegating to Node's own listeners prints every other warning exactly as Node would, and keeps `--no-warnings`
// working, because Node registers no listener under it.
const nodeWarningListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
    if (warning.name === "ExperimentalWarning" && warning.message.startsWith("FFI ")) {
        return;
    }
    for (const listener of nodeWarningListeners) {
        listener(warning);
    }
});

process.getBuiltinModule("node:module").enableCompileCache();

await import("./main.ts");
