var _a;
import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        tailwindcss(),
        react(),
        electron({
            main: {
                // Shortcut of `build.lib.entry`.
                entry: "electron/main.ts",
                vite: {
                    define: {
                        __filename: "import.meta.url",
                        // Build-time injection for releases (CI sets LAUNCHER_SECRET_KEY as an env var).
                        // NOTE: This value becomes part of the bundled JS and is not truly secret in distributed binaries.
                        __LAUNCHER_SECRET_KEY__: JSON.stringify((_a = process.env.LAUNCHER_SECRET_KEY) !== null && _a !== void 0 ? _a : ""),
                    },
                },
            },
            preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: path.join(__dirname, "electron/preload.ts"),
            },
            // Ployfill the Electron and Node.js API for Renderer process.
            // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
            // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: process.env.NODE_ENV === "test"
                ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
                    undefined
                : {},
        }),
    ],
});
