// vitest.config.js
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	test: {
		// You might need to specify environment depending on your tests,
		// but 'node' (default) or 'jsdom' are common.
		// environment: 'jsdom',
		globals: true, // Optional: Use if you prefer global test functions (describe, it, etc.)
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(
				new URL("./src/test-utils/obsidian.ts", import.meta.url),
			),
		},
	},
});
