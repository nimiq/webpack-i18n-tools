import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { jsonLibCommand } from './api.js';
import { createTempDir, fixture } from './utils.js';

describe('json lib converter', () => {
    it('converts a language file to json files per referenced source file', () => {
        const projectDir = createTempDir();
        fs.mkdirSync(path.join(projectDir, 'src/i18n'), { recursive: true });
        fs.copyFileSync(
            path.join(fixture('bundle'), 'src/i18n/de.po'),
            path.join(projectDir, 'src/i18n/de.po'),
        );
        execFileSync(process.execPath, jsonLibCommand('src/i18n/de.po'), { cwd: projectDir, stdio: 'pipe' });

        const outputDir = path.join(projectDir, 'src/i18n/de');
        const outputFiles = Object.fromEntries(fs.readdirSync(outputDir).sort().map((fileName) => [
            fileName,
            JSON.parse(fs.readFileSync(path.join(outputDir, fileName), 'utf8')),
        ]));
        expect(outputFiles).toMatchSnapshot();
    });
});
