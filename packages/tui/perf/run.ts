// The `perf` entry point. React picks its build when it is first loaded, so this asks for the production build, as
// src/main.ts does while it loads the app, before perf/measure.ts imports anything.
// @effect-diagnostics processEnv:off

if (process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = "production";
}

await import("./measure.ts");
