// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// You might need to specify environment depending on your tests,
		// but 'node' (default) or 'jsdom' are common.
		// environment: 'jsdom',
		globals: true, // Optional: Use if you prefer global test functions (describe, it, etc.)
	},
	resolve: {
		alias: {
			// Prevent Vite from trying to resolve the actual 'obsidian' package.
			// Aliasing it to a non-existent path tells Vite to stop looking for it.
			// The vi.mock in the test file will handle providing a mock implementation.
			obsidian: "/nonexistent-path/obsidian.js", // Use a clearly invalid path
		},
	},
});
