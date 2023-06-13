const fs = require('fs');
const path = require('path');

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
            const loaderContext = /** @type {import('webpack').loader.LoaderContext} */ (/** @type {unknown} */ (this));
            const loader = require('./loader').bind(loaderContext);
            return loader(source);
        } else {
            // webpack plugin
            return require('./plugin');
        }
    };
}
