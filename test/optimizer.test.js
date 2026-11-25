import fs from 'node:fs';
import path from 'node:path';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
import { build } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { poLoader, poOptimizer } from './api.js';
import { fixture } from './utils.js';

const input = path.join(fixture('bundle'), 'src/main.js');

/**
 * @typedef {import('rollup').OutputChunk | import('rolldown').OutputChunk} OutputChunk
 * @typedef {import('rollup').OutputAsset | import('rolldown').OutputAsset} OutputAsset
 * @typedef {{ output: Array<OutputChunk | OutputAsset>, warnings: string[] }} BuildResult
 */

/** @type {Record<string, () => Promise<BuildResult>>} */
const bundlers = {
    // Rollup, without minification
    async rollup() {
        /** @type {string[]} */
        const warnings = [];
        const bundle = await rollup({
            input,
            // The plugins are typed as Vite plugins.
            plugins: /** @type {import('rollup').Plugin[]} */ (/** @type {unknown} */ ([poLoader(), poOptimizer()])),
            onLog(level, log) {
                if (level === 'warn' && log.plugin === 'po-optimizer') warnings.push(log.message);
            },
        });
        const { output } = await bundle.generate({
            format: 'es',
            sourcemap: true,
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
        });
        return { output, warnings };
    },
    // Rolldown, as used by Vite 8, with minification
    async rolldown() {
        /** @type {string[]} */
        const warnings = [];
        const bundle = await rolldown({
            input,
            plugins: [poLoader(), poOptimizer()],
            onLog(level, log) {
                if (level === 'warn' && log.plugin === 'po-optimizer') warnings.push(log.message);
            },
        });
        const { output } = await bundle.generate({
            format: 'es',
            sourcemap: true,
            minify: true,
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
        });
        return { output, warnings };
    },
    // Vite 8, which rewrites the sourcemaps of chunks with dynamic imports
    async vite() {
        /** @type {string[]} */
        const warnings = [];
        const result = await build({
            root: fixture('bundle'),
            configFile: false,
            logLevel: 'silent',
            plugins: [poLoader(), poOptimizer()],
            build: {
                write: false,
                sourcemap: true,
                minify: true,
                modulePreload: { polyfill: false },
                rolldownOptions: {
                    input,
                    // Keep the exports, which are otherwise removed in app builds, such that the code is not tree-shaken.
                    preserveEntrySignatures: 'exports-only',
                    output: {
                        entryFileNames: '[name].js',
                        chunkFileNames: '[name].js',
                    },
                    onLog(level, log) {
                        if (level === 'warn' && log.plugin === 'po-optimizer') warnings.push(log.message);
                    },
                },
            },
        });
        const { output } = Array.isArray(result)
            ? result[0]
            : /** @type {import('vite').Rolldown.RolldownOutput} */ (result);
        return { output, warnings };
    },
};

/**
 * @param {BuildResult['output']} output
 * @returns {OutputChunk[]}
 */
const getChunks = (output) =>
    /** @type {OutputChunk[]} */ (output.filter(({ type }) => type === 'chunk')).toSorted((a, b) =>
        a.fileName.localeCompare(b.fileName),
    );

describe.each(Object.keys(bundlers))('po optimizer with %s', (bundlerName) => {
    /** @type {BuildResult} */
    let result;
    const buildOnce = async () => (result ||= await bundlers[bundlerName]());

    it('optimizes language files and translation usages', async () => {
        const { output } = await buildOnce();
        for (const { fileName, code } of getChunks(output)) {
            expect(code).toMatchSnapshot(fileName);
        }
    });

    it('warns about missing and unused translations', async () => {
        const { warnings } = await buildOnce();
        expect(warnings).toMatchSnapshot();
    });

    it('writes the updated sourcemaps into the sourcemap files', async () => {
        const { output } = await buildOnce();
        for (const chunk of getChunks(output)) {
            const sourcemapFileName = chunk.sourcemapFileName || `${chunk.fileName}.map`;
            const sourcemapFile = /** @type {OutputAsset | undefined} */ (
                output.find(({ fileName }) => fileName === sourcemapFileName)
            );
            expect(sourcemapFile, sourcemapFileName).toBeDefined();
            expect(JSON.parse(String(sourcemapFile?.source)), sourcemapFileName).toEqual(JSON.parse(String(chunk.map)));
        }
    });

    it('maps translation usages to their original source lines', async () => {
        const { output } = await buildOnce();
        let checkedUsages = 0;
        for (const chunk of getChunks(output)) {
            if (!chunk.map || chunk.fileName.endsWith('.po.js') || /^(en|de)\.js$/.test(chunk.fileName)) continue;
            const traceMap = new TraceMap(JSON.parse(String(chunk.map)));
            const lines = chunk.code.split('\n');
            for (const [lineIndex, line] of lines.entries()) {
                for (const match of line.matchAll(/\$t\(|\.tc\(/g)) {
                    const { source, line: originalLine } = originalPositionFor(traceMap, {
                        line: lineIndex + 1,
                        column: match.index,
                    });
                    expect(source, `${chunk.fileName}:${lineIndex + 1}:${match.index}`).toBeTruthy();
                    // All source files of the fixture are directly in its src folder.
                    const sourceFile = path.join(path.dirname(input), path.basename(/** @type {string} */ (source)));
                    const originalCode = fs.readFileSync(sourceFile, 'utf8').split('\n')[
                        /** @type {number} */ (originalLine) - 1
                    ];
                    expect(originalCode, `${chunk.fileName}:${lineIndex + 1}:${match.index}`).toMatch(/\$t\(|\.tc\(/);
                    checkedUsages++;
                }
            }
        }
        expect(checkedUsages).toBe(13);
    });
});
