import { defineConfig } from 'vite-plus';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
    },
    lint: {
        ignorePatterns: ['types/**', 'test/fixtures/**'],
        plugins: ['eslint', 'oxc', 'typescript', 'import', 'node', 'jsdoc', 'unicorn', 'promise', 'vitest'],
        categories: {
            correctness: 'error',
            suspicious: 'error',
            perf: 'error',
        },
        options: {
            typeAware: true,
            typeCheck: true,
        },
        rules: {
            // Type assertions via JSDoc casts are used deliberately.
            'typescript/no-unsafe-type-assertion': 'off',
            // Vitest supports a message as second argument.
            'vitest/valid-expect': ['error', { maxArgs: 2 }],
        },
    },
});
