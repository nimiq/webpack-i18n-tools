import type { Plugin } from 'vite';
/**
 * @import { Plugin, Rollup } from 'vite'
 * @import { Source } from 'webpack-sources'
 * @import { ChunkInfo } from './process-chunks.js'
 */
/**
 * Plugin for Vite, Rollup and Rolldown, that optimizes the language files imported via the poLoader and the usages of
 * their translations, by replacing the translation keys by short indices. Missing translations are added to the
 * language files, with the source language's translation as fallback. The source language file has to be en.po.
 *
 * @returns {Plugin}
 */
export declare function poOptimizer(): Plugin;
