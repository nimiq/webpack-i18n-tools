# webpack-i18n-tools

A set of utilities for internationalizing applications or component libraries with gettext `.po` language files. These
tools are optimized for projects that are internationalized using [vue-i18n](https://vue-i18n.intlify.dev/) and built
with [Vite](https://vite.dev/), [Rollup](https://rollupjs.org/) or [Rolldown](https://rolldown.rs/), but are also
compatible with frameworks which use a similar api as vue-i18n.

Despite its name, the library doesn't support webpack anymore.

Requires Node.js 22.17 or newer. Type declarations are included. The plugins are typed as plugins of the installed Vite
version, therefore Rollup and Rolldown projects without Vite might need to cast them.

## Installation

```bash
pnpm add -D github:nimiq/webpack-i18n-tools
```

## Extractor

The extractor extracts strings from the code base into a `.po` language file. This `.po` file can then be translated,
either in a text editor or more comfortably with tools like [Poedit](https://poedit.net/) or
[Transifex](https://www.transifex.com/).

The strings are detected in the source code as parameters to vue-i18n's `$t`, `$tc` and `$te` api calls (and variants).
The extractor also supports extracting translations from templates declared in
[Vue single file components](https://vuejs.org/guide/scaling-up/sfc.html), including usage of vue-i18n's
[component interpolation](https://vue-i18n.intlify.dev/guide/advanced/component.html).

Usage:
```bash
i18n-tools extract <output-language-file> [--source-dir <dir>]
```

For example, as a script in `package.json`:
```json
{
    "scripts": {
        "i18n:extract": "i18n-tools extract src/i18n/en.po"
    }
}
```

The js, ts and vue files in the source directory, `src` by default, are searched. The extractor can also be used
programmatically:
```javascript
import { extract } from 'webpack-i18n-tools/extractor';

const extractor = await extract({ sourceDir: 'src' });
extractor.savePotFile('src/i18n/en.po');
```

The extractor implementation is based on https://gist.github.com/paumoreno/cdfa14942424e895168a269a2deef1f3.

## Loader

This Vite / Rollup / Rolldown plugin enables imports of `.po` files. The translations in the imported `.po` file are
provided as an object of translation keys and translations, which falls back to the key for untranslated and fuzzy
translations. The files to transform can be limited via the `include` and `exclude` options, which accept the same
patterns as [@rollup/pluginutils' createFilter](https://github.com/rollup/plugins/tree/master/packages/pluginutils#createfilter).

The loader implementation is based on https://github.com/perchlabs/po-loader.

## Optimizer

This Vite / Rollup / Rolldown plugin optimizes language files imported via the loader and the usages of contained
translations by accessing / indexing translations by a short key instead of original long keys. It also adds a fallback
for missing translations such that no separate fallback / source language file needs to be loaded. The source language
file has to be named `en.po`, and each language file has to be imported dynamically, such that it becomes its own chunk.

Usage of the loader and optimizer:
```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { poLoader, poOptimizer } from 'webpack-i18n-tools';

export default defineConfig({
    plugins: [
        poLoader(),
        poOptimizer(),
    ],
});
```

## JSON lib converter

This converter converts `.po` language files into JSON files, one JSON file per source file. This is useful for
authoring component libraries where components can be imported independently with their respective translations without
the need to load the entire language file. See Nimiq's [vue-components](https://github.com/nimiq/vue-components) for an
example of such a component library.

Usage:
```bash
i18n-tools json-lib "<language file or glob>" [--output-dir <dir>]
```

The JSON files of a language file `<language>.po` are written to `<output-dir>/<language>/`, with `src/i18n` as default
output directory. The converter can also be used programmatically:
```javascript
import { convertToJsonLib } from 'webpack-i18n-tools/json-lib';

convertToJsonLib({ input: 'src/i18n/!(en).po', outputDir: 'src/i18n' });
```

## Development

The project uses [Vite+](https://viteplus.dev/) and pnpm. Install the dependencies via `vp install`, and run the tests
via `vp test`.

The library is written in JavaScript with types in JSDoc comments, such that it can be used from git without a build
step. Type check it via `pnpm typecheck`. The type declarations in `types/` are generated from the JSDoc types via
`pnpm types`, and committed.
