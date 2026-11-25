// The library's api as used by the tests.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

export const poLoader = require('../loader/rollup.js');
export const poOptimizer = require('../optimizer/rollup.js');

/** @param {string} outputFile */
export const extractCommand = (outputFile) => [path.join(root, 'index.js'), outputFile];

/** @param {string} inputGlob */
export const jsonLibCommand = (inputGlob) => [path.join(root, 'tools/convertToJsonLib.js'), inputGlob];
