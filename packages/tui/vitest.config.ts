import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: { conditions: ["@otelscope/source"] },
    test: {
        include: ["test/**/*.test.{ts,tsx}"],
        globals: false,
    },
});
