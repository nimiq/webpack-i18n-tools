# webpack-i18n-tools

A set of utilities for internationalizing applications or component libraries. These tools are optimized for projects
that are internationalized using [vue-i18n](https://kazupon.github.io/vue-i18n/) but are also compatible with frameworks
which use a similar api as vue-i18n.

## Extractor

The extractor extracts strings from the code base into a `.po` language file. This `.po` file can then be translated,
either in a text editor or more comfortably with tools like [Poedit](https://poedit.net/) or
[Transifex](https://www.transifex.com/).

The strings are detected in the source code as parameters to vue-i18n's `$t`, `$tc` and `$te` api calls (and variants).
The extractor also supports extracting translations from templates declared in
[Vue single file components](https://vuejs.org/v2/guide/single-file-components.html), including usage of `vue-i18n`'s
[component interpolation](https://kazupon.github.io/vue-i18n/guide/interpolation.html#basic-usage).

Usage:
```bash
node node_modules/webpack-i18n-tools/index.js <output-language-file>
```

The extractor implementation is based on https://gist.github.com/paumoreno/cdfa14942424e895168a269a2deef1f3.

## Loader

This webpack loader enables imports of `.po` files. The translations in the imported `.po` file are provided as a JSON
object.

Usage:
```javascript
// webpack.config.js:
module.exports = {
  module: {
    rules: [
      { test: /\.pot?$/, use: 'webpack-i18n-tools' }
    ]
  },
  ...
};

// Or for projects created via vue-cli:
module.exports = {
    chainWebpack: (config) => {
        config.module
            .rule('po')
                .test(/\.pot?$/)
                .use('po-loader')
                .loader('webpack-i18n-tools')
                .end()
            .end();
    },
    ...
};
```

The loader implementation is based on https://github.com/perchlabs/po-loader.

## Optimizer

This webpack plugin optimizes language files imported via the loader and the usages of contained translations by
accessing / indexing translations by a short key instead of original long keys. It also adds a fallback for missing
translations such that no separate fallback / source language file needs to be loaded.

Usage:
```javascript
// webpack.config.js:
const PoLoaderOptimizer = require('webpack-i18n-tools')();
module.exports = {
  plugins: [
    new PoLoaderOptimizer(),
  ],
  ...
};

// Or for projects created via vue-cli:
const PoLoaderOptimizer = require('webpack-i18n-tools')();
module.exports = {
    configureWebpack: {
        plugins: [
            new PoLoaderOptimizer(),
        ],
    },
    ...
};
```

## JSON lib converter

This converter converts `.po` language files into JSON files, one JSON file per component. This is useful for authoring
component libraries where components can be imported independently with their respective translations without the need
to load the entire language file. See Nimiq's [vue-components](https://github.com/nimiq/vue-components) for an example
of such a component library.

Usage:
```bash
node node_modules/webpack-i18n-tools/tools/convertToJsonLib.js "<language file or glob>"
```
