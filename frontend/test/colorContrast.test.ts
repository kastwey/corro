import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastingTextColor } from '../src/colorContrast.js';

test('contrastingTextColor chooses black for bright package colours', () => {
	assert.equal(contrastingTextColor('#ecc23a'), '#000000');
	assert.equal(contrastingTextColor('#5fce6a'), '#000000');
	assert.equal(contrastingTextColor('#e53935'), '#000000');
	assert.equal(contrastingTextColor('#1e88e5'), '#000000');
	assert.equal(contrastingTextColor('#43a047'), '#000000');
	assert.equal(contrastingTextColor('#fdd835'), '#000000');
	assert.equal(contrastingTextColor('#fff'), '#000000');
});

test('contrastingTextColor chooses white for dark package colours', () => {
	assert.equal(contrastingTextColor('#2f6fe0'), '#ffffff');
	assert.equal(contrastingTextColor('#8a5a2b'), '#ffffff');
	assert.equal(contrastingTextColor('#000'), '#ffffff');
});

test('contrastingTextColor safely rejects non-hex package input', () => {
	assert.equal(contrastingTextColor('red; color: transparent'), '#ffffff');
	assert.equal(contrastingTextColor('#abcd'), '#ffffff');
});
