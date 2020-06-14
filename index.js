const fs = require('fs');
const path = require('path');

if (
	process
	&& process.argv
	&& process.argv[2]
	&& !process.argv[2].includes('build')
	&& !process.argv[2].includes('serve')
	&& fs.existsSync(path.dirname(process.argv[2]))
	&& path.extname(process.argv[2])
) { // script
	return require('./extractor')();
}
else {
	module.exports = (source) => {
		if (source) { // webpack loader
			return require('./loader')(source);
		}
		else { // webpack plugin
			return require('./plugin');
		}
	};
}
