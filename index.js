const fs = require('fs');
const path = require('path');

/**
 * @typedef {import('webpack4types').loader.LoaderContext} Webpack4LoaderContext
 * @typedef {import('webpack5').LoaderContext<object>} Webpack5LoaderContext
 * @typedef {Webpack4LoaderContext|Webpack5LoaderContext} WebpackLoaderContext
 */

if (
    process
    && process.argv
    && process.argv[2]
    && !process.argv[2].includes('build')
    && !process.argv[2].includes('serve')
    && fs.existsSync(path.dirname(process.argv[2]))
    && path.extname(process.argv[2])
) {
    // extractor
    require('./extractor')();
} else {
    module.exports = (/** @type {string} */ source) => {
        if (source) {
            // webpack loader
            const loaderContext = /**@type {WebpackLoaderContext}*/ (/**@type {unknown}*/ (this));
            const loader = require('./loader').bind(loaderContext);
            return loader(source);
        } else {
            // webpack plugin
            return require('./plugin');
        }
    };
}
