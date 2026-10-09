import { useKeyboard } from "@opentui/react";

import type { ReactNode } from "react";

export interface AppProps {
    readonly onQuit: () => void;
}

export const App = (props: AppProps): ReactNode => {
    useKeyboard((key) => {
        if (key.name === "q" || (key.ctrl && key.name === "c")) {
            props.onQuit();
        }
    });
    return <box flexGrow={1} />;
};
