import { GettextExtractor } from 'gettext-extractor';
/**
 * Extract the translations used in the js, ts and vue files in a source directory.
 *
 * @param {object} [options]
 * @param {string} [options.sourceDir] - The directory to search, relative to the working directory. Defaults to src.
 * @returns {Promise<GettextExtractor>} The extractor holding the extracted translations, for example for saving them via
 *     savePotFile.
 */
export declare function extract({ sourceDir }?: {
    sourceDir?: string;
}): Promise<GettextExtractor>;
//# sourceMappingURL=extractor.d.ts.map