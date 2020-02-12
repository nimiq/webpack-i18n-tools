'use strict';
if (
	process
	&& process.argv
	&& process.argv[2]
	&& !process.argv[2].includes('build')
	&& !process.argv[2].includes('serve')
) { // script
	require('./script')();
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
