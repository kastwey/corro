import test from 'node:test';
import assert from 'node:assert/strict';

// Tooling is CommonJS so dev.ps1 can launch it directly on every supported platform.
// Requiring it is side-effect free: the watcher starts only when watch.js is the entry point.
const { destinationFor } = require('../watch.js') as {
	destinationFor: (sourcePath: string) => string | null;
};

test('the complete frontend watcher mirrors every static input class into dist', () => {
	assert.equal(destinationFor('src/index.html'), 'index.html');
	assert.equal(destinationFor('src\\board.html'), 'board.html');
	assert.equal(destinationFor('styles.css'), 'styles.css');
	assert.equal(destinationFor('gameStatus.json'), 'gameStatus.json');
	assert.equal(destinationFor('css/theme.css'), 'css/theme.css');
	assert.equal(destinationFor('i18n/locales/es.json'), 'i18n/locales/es.json');
	assert.equal(destinationFor('assets/sounds/finger.ogg'), 'assets/sounds/finger.ogg');
});

test('TypeScript and unrelated files are left to their own build pipelines', () => {
	assert.equal(destinationFor('src/app.ts'), null, 'the TypeScript watch API emits JS');
	assert.equal(destinationFor('test/example.test.ts'), null);
	assert.equal(destinationFor('package.json'), null, 'dependency changes require a watcher restart');
});
