import type { Source } from 'webpack-sources';
export type ChunkInfo = {
    filename: string;
    source: Source;
};
export type ParsedLanguageChunkInfo = ChunkInfo & {
    translations: Record<string, string>;
    translationsCode: string;
    translationsCodePosition: number;
};
/**
 * @param {ChunkInfo[]} languageChunkInfos
 * @param {ChunkInfo[]} otherChunkInfos
 * @param {(filename: string, source: Source) => void} updateChunk
 * @param {(message: string) => void} emitWarning
 */
export declare function processChunks(languageChunkInfos: ChunkInfo[], otherChunkInfos: ChunkInfo[], updateChunk: (filename: string, source: Source) => void, emitWarning: (message: string) => void): void;
//# sourceMappingURL=process-chunks.d.ts.map