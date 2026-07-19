import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = path.resolve(__dirname, '..', 'src');

/**
 * The lobby owns its package-unlock chord; gameplay owns engine/package/family shortcuts.
 * Keeping separate page entry points prevents a lobby capture listener from stealing any
 * key declared by the active game.
 */
test('lobby and board keyboard entry points stay isolated', () => {
	const lobby = readFileSync(path.join(src, 'index.html'), 'utf8');
	const board = readFileSync(path.join(src, 'board.html'), 'utf8');

	assert.match(lobby, /<script type="module" src="lobby\/index\.js"><\/script>/);
	assert.doesNotMatch(lobby, /<script type="module" src="app\.js"><\/script>/);
	assert.match(board, /<script type="module" src="app\.js"><\/script>/);
	assert.doesNotMatch(board, /<script type="module" src="lobby\/index\.js"><\/script>/);
});
