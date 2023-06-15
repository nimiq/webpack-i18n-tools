const po2json = require('po2json');

/**
 * @this {import('webpack').LoaderContext<object>}
 * @param {string | Buffer} source
 * @returns {string}
 */
module.exports = function(source) {
    /** @type {object} */
    let options;
    if ('getOptions' in this) {
        // Webpack 5
        options = this.getOptions();
    } else {
        // Webpack 4
        // We purposefully don't update loader-utils to version 3 or beyond as it doesn't support getOptions anymore in
        // favor of Webpack 5's getOptions.
        options = require('loader-utils').getOptions(this);
    }

    // Note: the spaces here are important for distinguishing a dev build from a minified production build in
    // parseLanguageFile in plugin/index.js.
    return `module.exports = ${po2json.parse(source, {
        // defaults
        format: 'mf',
        'fallback-to-msgid': true,
        
        ...options,
        
        // enforce stringification
        stringify: true,
    })}`;
};
