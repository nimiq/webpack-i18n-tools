#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { extract } from './extractor.js';
import { convertToJsonLib } from './json-lib.js';

const usage = `Usage:
  i18n-tools extract <output-language-file> [--source-dir <dir>]
      Extract the translations used in the js, ts and vue files in the source directory (default: src) into a .po
      language file, typically the source language file, for example src/i18n/en.po.

  i18n-tools json-lib <language-file-or-glob> [--output-dir <dir>]
      Convert language files into JSON files, one per source file referenced in the language file, into
      <output-dir>/<language>/ (default output dir: src/i18n).`;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
    console.error(`${message}\n\n${usage}`);
    process.exit(1);
}

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        'source-dir': { type: 'string' },
        'output-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
    },
});
const [command, target, ...rest] = positionals;

if (values.help) {
    console.log(usage);
    process.exit(0);
}
if (rest.length) fail(`Unexpected arguments: ${rest.join(' ')}`);

switch (command) {
    case 'extract': {
        if (!target || !path.extname(target)) fail('The path of the output language file is missing.');
        const extractor = await extract({ sourceDir: values['source-dir'] });
        console.log('i18n extractor stats (note that the file count includes not only files but all parsed snippets):');
        extractor.printStats();
        extractor.savePotFile(target);
        break;
    }
    case 'json-lib': {
        if (!target) fail('The language file or glob is missing.');
        const convertedFiles = convertToJsonLib({ input: target, outputDir: values['output-dir'] });
        if (!convertedFiles.length) fail(`No language files found for ${target}.`);
        break;
    }
    default:
        fail(command ? `Unknown command ${command}.` : 'The command is missing.');
}
