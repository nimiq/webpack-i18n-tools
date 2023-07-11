// Import WebpackError in a fashion that's compatible with Webpack 4 and Webpack 5 (Webpack 4 does not expose
// require('webpack').WebpackError).
// @ts-expect-error: no type definitions for file import. Assume Webpack 5 types because not defined in @types/webpack@4
const WebpackError = /** @type {typeof import('webpack5').WebpackError} */ (require('webpack/lib/WebpackError'));
const processChunks = require('./common.js');

/**
 * @typedef {import('tapable1types').Tapable.Plugin} Webpack4Plugin
 * @typedef {import('webpack4types').Compiler} Webpack4Compiler
 * @typedef {import('webpack4types').compilation.Compilation} Webpack4Compilation
 *
 * @typedef {import('webpack5').WebpackPluginInstance} Webpack5Plugin
 * @typedef {import('webpack5').Compiler} Webpack5Compiler
 * @typedef {import('webpack5').Compilation} Webpack5Compilation
 * @typedef {typeof import('webpack5').Compilation} Webpack5CompilationConstructor
 *
 * @typedef {Webpack4Compiler|Webpack5Compiler} WebpackCompiler
 * @typedef {Webpack4Compilation|Webpack5Compilation} WebpackCompilation
 *
 * @typedef {import('webpack5').sources.Source} Source - Actually is from webpack-sources, but use types from webpack5
 *
 * @typedef {import('./common').ChunkInfo} ChunkInfo
 * @typedef {import('./common').LanguageChunkInfo} LanguageChunkInfo
 */

/**
 * Webpack plugin that optimizes language files and their usage by replacing translation keys by shorter numbers while
 * preserving proper sourcemaps.
 *
 * Note that we use a plugin and not a webpack loader as loaders should not depend on other assets and plugins are
 * generally more powerful.
 *
 * Useful documentation for writing webpack plugins (listed in recommended read order):
 * - Overview over assets, chunks, modules and dependencies: https://webpack.js.org/contribute/plugin-patterns/
 * - Introduction on how to write a plugin: https://webpack.js.org/contribute/writing-a-plugin/
 * - Plugin Api: https://webpack.js.org/api/plugins/
 * - Compiler hooks: https://webpack.js.org/api/compiler-hooks/
 * - Compilation hooks: https://webpack.js.org/api/compilation-hooks/
 * - Compilation Api: https://webpack.js.org/api/compilation-object/
 * - Javascript Parser hooks: https://webpack.js.org/api/parser/
 *
 * To get a better feeling for the build process and when a hook is invoked, search the webpack code base for
 * hooks.<hookName>.call
 *
 * Useful utilities for writing a plugin:
 * - Changing sources without breaking sourcemaps: https://github.com/webpack/webpack-sources
 *
 * Useful example plugins for a better understanding of different approaches to writing plugins:
 * - BannerPlugin: https://github.com/webpack/webpack/blob/master/lib/BannerPlugin.js
 *   Simple source code manipulation via webpack-sources and straight forward usage of compilation hooks
 * - DefinePlugin: https://github.com/webpack/webpack/blob/master/lib/DefinePlugin.js
 *   Code manipulation via the Javascript parser using ConstDependency instances (created by toConstDependency from
 *   https://github.com/webpack/webpack/blob/master/lib/javascript/JavascriptParserHelpers.js) as compiler template
 *   dependencies which get applied by the compiler and perform code replacements at module code generation time (see
 *   https://github.com/webpack/webpack/blob/master/lib/dependencies/ConstDependency.js#L72).
 *   See https://stackoverflow.com/a/52906440 for a reduction of this approach to the essential parts (but without
 *   involving the parser).
 *
 *   @implements {Webpack4Plugin}
 *   @implements {Webpack5Plugin}
 */
class I18nOptimizerPlugin {
    /**
     * @param {WebpackCompiler} compiler
     */
    apply(compiler) {
        compiler.hooks.compilation.tap(this.constructor.name, (compilation) => {
            if (typeof compiler.options.devtool === 'string' && compiler.options.devtool.includes('eval')) {
                this.emitCompilationError(compilation, `${this.constructor.name} is currently not compatible with eval `
                    + 'devtool settings. Please use a different setting like `source-map`.');
                return;
            }

            if ('processAssets' in compilation.hooks) {
                // Webpack >= 5
                const Compilation = /** @type {Webpack5CompilationConstructor} */ (compilation.constructor);
                compilation.hooks.processAssets.tap(
                    {
                        name: this.constructor.name,
                        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
                    },
                    () => this.processAssets(compilation),
                );
            } else {
                // Webpack < 5
                compilation.hooks.optimizeChunkAssets.tap(
                    this.constructor.name,
                    () => this.processAssets(compilation),
                );
            }
        });
    }

    /**
     * @param {WebpackCompilation} compilation
     */
    processAssets(compilation) {
        /** @type {{[filename: string]: Source}} */
        const chunks = compilation.assets; // maps filename -> source

        // categorize assets and parse language files
        /** @type {LanguageChunkInfo[]} */
        const languageChunkInfos = [];
        /** @type {ChunkInfo[]} */
        const otherChunkInfos = [];
        for (const [filename, source] of Object.entries(chunks)) {
            if (!filename.endsWith('.js') || filename.includes('chunk-vendors')) continue;
            const sourceContent = source.source();
            if (typeof sourceContent !== 'string') continue;
            if (/-po(?:-legacy)?(?:\.[^.]*)?\.js$/.test(filename)) {
                try {
                    languageChunkInfos.push({
                        filename,
                        source,
                        ...this.parseLanguageChunk(sourceContent),
                    });
                } catch (e) {
                    this.emitCompilationError(compilation, `${this.constructor.name}: Failed to parse language file `
                        + `${filename}. Note that currently bundling of language files is not supported by our webpack `
                        + 'plugin. Each language file has to be its own chunk. Also, using EvalSourceMapDevToolPlugin '
                        + 'or EvalDevToolModulePlugin is currently not supported.');
                    return;
                }
            } else {
                otherChunkInfos.push({ filename, source });
            }
        }

        try {
            processChunks(
                languageChunkInfos,
                otherChunkInfos,
                (filename, source) => this.updateChunk(compilation, filename, source),
                (warning) => this.emitCompilationError(compilation, warning, 'warning'),
            );
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.emitCompilationError(compilation, errorMessage);
        }
    }

    /**
     * @param {string} code
     * @returns {{translationsCode: string, prefix: string, suffix: string}}
     */
    parseLanguageChunk(code) {
        const PREFIX_BUILD = /^.*?exports=/s;
        const SUFFIX_BUILD = /}}]\);.*$/s;

        const PREFIX_SERVE = /^.*?exports = /s;
        const SUFFIX_SERVE = /\n{2}\/\*{3}\/ }\).*$/s;

        let prefix, suffix;
        if (!code.match(PREFIX_BUILD)) {
            prefix = code.match(PREFIX_SERVE)?.[0];
            suffix = code.match(SUFFIX_SERVE)?.[0];
        } else {
            prefix = code.match(PREFIX_BUILD)?.[0];
            suffix = code.match(SUFFIX_BUILD)?.[0];
        }

        if (!prefix || !suffix) throw new Error('Failed to parse language file.');

        const translationsCode = code.substring(prefix.length, code.length - suffix.length);

        return {
            translationsCode,
            prefix,
            suffix,
        };
    }

    /**
     * @param {WebpackCompilation} compilation
     * @param {string} filename
     * @param {Source} source
     */
    updateChunk(compilation, filename, source) {
        if ('options' in compilation) {
            // Webpack 5
            compilation.updateAsset(filename, source);
        } else if ('updateAsset' in compilation) {
            // Webpack >= 4.40
            // Source from webpack-sources is compatible with Webpack 4 and Webpack 5, but @types/webpack@4 has
            // incompatible type definitions from outdated @types/webpack-sources.
            compilation.updateAsset(filename, /** @type {import('webpack-sources').Source} */ (source));
        } else {
            // @ts-ignore: Webpack < 4.40
            compilation.assets[filename] = source;
        }
    }

    /**
     * @param {WebpackCompilation} compilation
     * @param {string} message
     * @param {'error' | 'warning'} [level]
     */
    emitCompilationError(compilation, message, level = 'error') {
        const error = new WebpackError(message);
        error.name = `${this.constructor.name}${level === 'error' ? 'Error' : 'Warning'}`;
        compilation[level === 'error' ? 'errors' : 'warnings'].push(error);
    }
}

module.exports = I18nOptimizerPlugin;
