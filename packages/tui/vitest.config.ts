import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { conditions: ["@otelscope/source"] },
    // Tests run in the SSR environment, which resolves packages with these conditions, not the ones above.
    ssr: { resolve: { conditions: ["@otelscope/source"] } },
    test: {
        include: ["test/**/*.test.{ts,tsx}"],
        globals: false,
        env: { TZ: "UTC" },
    },
});
