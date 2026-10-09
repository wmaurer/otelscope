import { describe, expect, it } from "@effect/vitest";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

import { App } from "../../src/ui/App.tsx";

const width = 40;
const height = 8;

describe("App", () => {
    it("renders an empty frame and asks to quit on q and Ctrl-c only", async () => {
        let quits = 0;
        const setup = await testRender(<App onQuit={() => (quits += 1)} />, { width, height });
        try {
            await setup.renderOnce();
            expect(setup.captureCharFrame()).toBe(`${" ".repeat(width)}\n`.repeat(height));

            setup.mockInput.pressKey("x");
            expect(quits).toBe(0);
            setup.mockInput.pressKey("q");
            expect(quits).toBe(1);
            setup.mockInput.pressCtrlC();
            expect(quits).toBe(2);
        } finally {
            // The renderer unmounts the React root when it is destroyed, and React wants that inside act().
            act(() => setup.renderer.destroy());
        }
    });
});
