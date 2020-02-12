const fs = require('fs');
const path = require('path');
const glob = require("glob");

class PoLoaderOptimizer {

    constructor() {
        this.compiler = null;
        this.originalPoFile = null;
        this.poFiles = [];
    }

    parseFile(content) {
        const stringContent = content.toString();

        return {
            prefix: stringContent.match(/.*exports=/g)[0],
            suffix: stringContent.match(/}}]\);.*/g)[0],
            content: JSON.parse(
                stringContent
                    .replace(/.*exports=/g, '')
                    .replace(/}}]\);\s.*/g, '')
                    .replace(/(^{|",)(\w+):/g, '$1"$2":')
            ),
        };
    }

    done(statsData, cb) {
        this.root = this.compiler.options.context;
        if (statsData.hasErrors()) {
            return;
        }

        // replace long string keys by numbers in po files
        (() => {
            const tmp = {};
            Object.values(this.originalPoFile.content).map((value, i) => {
                tmp[i] = value;
            });
            this.originalPoFile.content = tmp;
        })();

        this.poFiles.forEach(poFile => {
            const tmp = {};

            Object.values(this.originalPoFile.content).forEach((value, i) => {
                tmp[i] = poFile.content[value] || value;
            });

            poFile.content = tmp;
        });

        // replace the keys from the js files too
        const files = glob.sync('./dist/**/*.js');

        const entries = Object.entries(this.originalPoFile.content);

        let i = files.length;
        while (i--) {
            let content = fs.readFileSync(files[i], 'utf8');

            for (const [k, v] of entries) {
                const regex = new RegExp(`["'](${v})["']`, 'g');
                content = content.replace(regex, `${k}`);
            }

            fs.writeFileSync(files[i], content);
        }

        // replace long string keys by numbers in po files
        fs.writeFileSync(
            "./dist/" + this.originalPoFile.filename,
            this.originalPoFile.prefix + JSON.stringify(this.originalPoFile.content) + this.originalPoFile.suffix
        );

        this.poFiles.forEach(poFile => {
            fs.writeFileSync(
                "./dist/" + poFile.filename,
                poFile.prefix + JSON.stringify(poFile.content) + poFile.suffix
            )
        });

        cb();
    }

    assetEmitted(file, content, cb) {
        if (/.*en-po.*\.js$/g.test(file)) {
            this.originalPoFile = {
                filename: file,
                ...this.parseFile(content)
            };
        } else if (/.*-po.*\.js$/g.test(file)) {
            this.poFiles.push({
                filename: file,
                ...this.parseFile(content)
            });
        }
        cb();
    }

	apply(compiler) {
        this.compiler = compiler;
        process.stdout.write('\n');

        compiler.hooks.assetEmitted.tapAsync('PoLoaderOptimizer', this.assetEmitted.bind(this));
        compiler.hooks.done.tapAsync('PoLoaderOptimizer', this.done.bind(this));
	}
}

module.exports = PoLoaderOptimizer;
