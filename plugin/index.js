const fs = require('fs');
const glob = require("glob");

const PREFIX_BUILD = /.*exports=/g;
const SUFFIX_BUILD = /}}]\);\s.*/g;

const PREFIX_SERVE = /[\w\W]+exports = /g;
const SUFFIX_SERVE = /\n{2}\/\*{3}\/ }\)[\W\w]+/g;

class PoLoaderOptimizer {

    constructor() {
        this.compiler = null;
        this.originalPoFile = null;
        this.poFiles = [];
    }

    parseFile(content) {
        const stringContent = content.toString();

        let prefix = '', suffix = '';
        if (!stringContent.match(PREFIX_BUILD)) {
            prefix = PREFIX_SERVE;
            suffix = SUFFIX_SERVE;
        } else {
            prefix = PREFIX_BUILD;
            suffix = SUFFIX_BUILD;
        }

        return {
            prefix: stringContent.match(prefix)[0],
            suffix: stringContent.match(suffix)[0],
            content: JSON.parse(
                stringContent
                    .replace(prefix, '')
                    .replace(suffix, '')
                    .replace(/(^{|",)(\w+):/g, '$1"$2":')
            ),
        };
    }

    done(statsData, cb) {
        this.root = this.compiler.options.context;
        if (statsData.hasErrors()) {
            return;
        }

        // replace long string keys by numbers in po objects
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

        // replace the keys from the js files and save file
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

        // save po files
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
