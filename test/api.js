// The library's api as used by the tests.
import path from 'node:path';

const cli = path.resolve(import.meta.dirname, '../src/cli.js');

export { poLoader, poOptimizer } from 'webpack-i18n-tools';

/** @param {string} outputFile */
export const extractCommand = (outputFile) => [cli, 'extract', outputFile];

/** @param {string} inputGlob */
export const jsonLibCommand = (inputGlob) => [cli, 'json-lib', inputGlob];
