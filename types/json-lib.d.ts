/**
 * Convert language files into JSON files, one JSON file per source file referenced in the language file, such that
 * components of a component library can be imported independently with their respective translations. The JSON files
 * of a language file <language>.po are written to <outputDir>/<language>/.
 *
 * @param {object} options
 * @param {string} options.input - A language file or a glob of language files.
 * @param {string} [options.outputDir] - Defaults to src/i18n.
 * @returns {string[]} The converted language files.
 */
export declare function convertToJsonLib({ input, outputDir }: {
    input: string;
    outputDir?: string;
}): string[];
