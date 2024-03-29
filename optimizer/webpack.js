const { createHash } = require('crypto');
// Import WebpackError in a fashion that's compatible with Webpack 4 and Webpack 5 (Webpack 4 does not expose
// require('webpack').WebpackError).
// @ts-expect-error: no type definitions for file import. Assume Webpack 5 types because not defined in @types/webpack@4
const WebpackError = /** @type {typeof import('webpack5').WebpackError} */ (require('webpack/lib/WebpackError'));
// Import JavascriptModulesPlugin for Webpack 5 only. While it exists for Webpack 4 too, it doesn't support what we want
// to use it for, has not types defined, and is not directly exposed on the webpack namespace.
const Webpack5JavascriptModulesPlugin = parseInt(require('webpack').version || '4') >= 5
    ? /** @type {import('webpack5')} */(/** @type {unknown} */ (require('webpack'))).javascript.JavascriptModulesPlugin
    : null;
const processChunks = require('./common.js');

/**
 * @typedef {import('tapable1types').Tapable.Plugin} Webpack4Plugin
 * @typedef {import('webpack4types').Compiler} Webpack4Compiler
 * @typedef {import('webpack4types').compilation.Compilation} Webpack4Compilation
 * @typedef {import('webpack4types').compilation.Chunk} Webpack4Chunk
 * @typedef {import('webpack4types').compilation.ChunkHash} Webpack4ChunkHash
 *
 * @typedef {import('webpack5').WebpackPluginInstance} Webpack5Plugin
 * @typedef {import('webpack5').Compiler} Webpack5Compiler
 * @typedef {import('webpack5').Compilation} Webpack5Compilation
 * @typedef {typeof import('webpack5').Compilation} Webpack5CompilationConstructor
 * @typedef {import('webpack5').Chunk} Webpack5Chunk
 * @typedef {ReturnType<import('webpack5').util.createHash>} Webpack5Hash
 *
 * @typedef {Webpack4Compiler|Webpack5Compiler} WebpackCompiler
 * @typedef {Webpack4Compilation|Webpack5Compilation} WebpackCompilation
 * @typedef {Webpack4Chunk|Webpack5Chunk} WebpackChunk
 * @typedef {Webpack4ChunkHash|Webpack5Hash} WebpackChunkHash
 * @typedef {import('webpack5').PathData} WebpackPathData - Not properly typed in Webpack 4
 *
 * @typedef {import('webpack5').sources.Source} Source - Actually is from webpack-sources, but use types from webpack5
 *
 * @typedef {import('./common').ChunkInfo} ChunkInfo
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
        const pluginName = this.constructor.name;

        compiler.hooks.compilation.tap(pluginName, (compilation) => {
            if (!('options' in compilation) || compilation.options.optimization.realContentHash === false) {
                // Webpack 4 or Webpack >= 5 with disabled realContentHash.
                // Augment content hashes of translation files with contents of the source language file. This is
                // because the content of the compiled translation file does not only depend on the translation po file,
                // but also on the source language file for added fallback translations and for translation indices. We
                // need to process hashes separately before the processAssets hook, because at processAssets, content
                // hashes and filenames are already finalized.
                // Note that Webpack works with multiple, independent hashes for internal purposes and content hashes in
                // filenames, such that hash changes made via the chunkHash compilation hook don't affect the filename
                // hashes, which is pretty unexpected and stupid... Instead, we need to patch contentHashes in filenames
                // separately via the chunkHash hook of the JavascriptModulesPlugin, which calculates the contentHash of
                // javascript files. This possibility only exists since Webpack 5, such that we use a hack in Webpack 4
                // to overwrite the contentHash set by JavascriptModulesPlugin via a custom setter and getter.
                // Previously, we also tried using the assetPath hook responsible for calculating final filenames, but
                // which only resulted in the filenames being changed, without the names in imports being changed
                // accordingly, which again is very stupid...
                // Note that starting with Webpack 5 actual file hashes of the final generated files are calculated by
                // default, unless realContentHash is explicitly disabled, which is the case in projects build with
                // vue-cli.
                compilation.hooks.chunkHash.tap(
                    pluginName,
                    (chunk, chunkHash) => this.augmentTranslationChunkHash(chunk, chunkHash, compilation),
                );
                if (Webpack5JavascriptModulesPlugin) {
                    // Webpack 5.
                    const javascriptModulesPluginHooks = Webpack5JavascriptModulesPlugin.getCompilationHooks(
                        /** @type {Webpack5Compilation} */ (compilation));
                    javascriptModulesPluginHooks.chunkHash.tap(
                        pluginName,
                        (chunk, chunkHash) => this.augmentTranslationChunkHash(chunk, chunkHash, compilation),
                    );
                } else if ('contentHash' in compilation.hooks) {
                    // Webpack 4.
                    // Note that the contentHash hook exists in Webpack 4 already, but is not documented and does not
                    // appear in the types. Maybe it did not exist in older versions of Webpack 4 yet.
                    compilation.hooks.contentHash.tap(
                        pluginName,
                        (chunk) => this.augmentTranslationContentHash(chunk, compilation),
                    );
                }
            }

            if ('processAssets' in compilation.hooks) {
                // Webpack >= 5
                const Compilation = /** @type {Webpack5CompilationConstructor} */ (compilation.constructor);
                compilation.hooks.processAssets.tap(
                    {
                        name: pluginName,
                        stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE,
                    },
                    () => this.processAssets(compilation),
                );
            } else {
                // Webpack < 5
                compilation.hooks.optimizeChunkAssets.tap(pluginName, () => this.processAssets(compilation));
            }
        });
    }

    /**
     * @param {WebpackChunk} chunk
     * @param {WebpackChunkHash} chunkHash
     * @param {WebpackCompilation} compilation
     */
    augmentTranslationChunkHash(chunk, chunkHash, compilation) {
        if (!chunk.name || !/(?<!\ben)-po$/.test(chunk.name)) return; // not a language chunk or English reference chunk
        const referenceLanguageModuleHash = this.getReferenceLanguageModuleHash(compilation);
        chunkHash.update(referenceLanguageModuleHash);
    }

    /**
     * @param {WebpackChunk} chunk
     * @param {WebpackCompilation} compilation
     */
    augmentTranslationContentHash(chunk, compilation) {
        if (!chunk.name || !/(?<!\ben)-po$/.test(chunk.name)) return; // not a language chunk or English reference chunk
        const referenceLanguageModuleHash = this.getReferenceLanguageModuleHash(compilation);
        if (!referenceLanguageModuleHash) return;
        // Hacky way of customizing chunk.contentHash.javascript set by JavascriptModulesPlugin in Webpack 4, which
        // does not provide a hook for augmenting the hash yet.
        let augmentedHash = referenceLanguageModuleHash;
        const hashDigest = compilation.outputOptions.hashDigest;
        Object.defineProperty(chunk.contentHash, 'javascript', {
            get() {
                return augmentedHash;
            },
            set(hash) {
                augmentedHash = createHash('sha256')
                    .update(referenceLanguageModuleHash)
                    .update(hash)
                    .digest()
                    .toString(hashDigest);
            },
        });
    }

    /**
     * @param {WebpackCompilation} compilation
     * @returns {string | null}
     */
    getReferenceLanguageModuleHash(compilation) {
        const referenceLanguageModule = [...compilation.modules].find((module) => /\ben\.po$/.test(module.resource));
        if (!referenceLanguageModule) {
            this.emitCompilationError(compilation, 'Reference language module en.po not found');
            return null;
        }
        return 'chunkGraph' in compilation && 'getModuleHash' in compilation.chunkGraph
            // Webpack 5
            ? compilation.chunkGraph.getModuleHash(referenceLanguageModule, undefined)
            // Webpack 4
            : referenceLanguageModule.hash;
    }

    /**
     * @param {WebpackCompilation} compilation
     */
    processAssets(compilation) {
        /** @type {{[filename: string]: Source}} */
        const chunks = compilation.assets; // maps filename -> source

        // If devtool is an eval option, e.g. using EvalSourceMapDevToolPlugin or EvalDevToolModulePlugin, the code
        // is wrapped into a string passed to eval. Within the string, quotes, backslashes and newlines are escaped.
        // Note that compilation.options already exists in Webpack 4, but is missing in types.
        const compilationOptions = (/** @type {{options: {devtool?: string}}} */ (compilation)).options;
        const isEvalWrapped = !!compilationOptions.devtool && compilationOptions.devtool.includes('eval');

        // categorize assets and parse language files
        /** @type {ChunkInfo[]} */
        const languageChunkInfos = [];
        /** @type {ChunkInfo[]} */
        const otherChunkInfos = [];
        for (const [filename, source] of Object.entries(chunks)) {
            if (!filename.endsWith('.js') || filename.includes('chunk-vendors')) continue;
            if (/-po(?:-legacy)?(?:\.[^.]*)?\.js$/.test(filename)) {
                languageChunkInfos.push({ filename, source, isEvalWrapped });
            } else {
                otherChunkInfos.push({ filename, source, isEvalWrapped });
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
            let errorMessage = e instanceof Error ? e.message : String(e);
            if (errorMessage.includes('Failed to parse')) {
                errorMessage += ' Note that currently bundling of language files is not supported by our webpack '
                    + 'plugin. Each language file has to be its own chunk.';
            }
            this.emitCompilationError(compilation, errorMessage);
        }
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
