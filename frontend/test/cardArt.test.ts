import test from 'node:test';
import assert from 'node:assert/strict';
import {
	cardArtStyle, cardArtSvg, genericCardArtHtml, genericCardBackHtml, genericEmptyCardHtml,
	normalizeCardArtColor,
	packageCardArtSvg, sanitizeCardPathData,
} from '../src/cardArt.js';

test('package path-data is sanitized again and marked as the winning source', () => {
	assert.equal(sanitizeCardPathData('M1 1h62v62z" onload="alert(1)'), 'M1 1h62v62z onloadalert1');
	const html = packageCardArtSvg('M1 1h62v62z"><script>alert(1)</script>')!;
	assert.match(html, /data-card-art="package"/);
	assert.doesNotMatch(html, /[<>]script|onload=/);
	assert.match(html, /viewBox="0 0 64 64"/);
});

test('package art wins and missing or unusable art receives a neutral mechanic drawing', () => {
	const custom = cardArtSvg({ type: 'attack', svg: 'M2 2h60v60z' });
	assert.match(custom, /data-card-art="package"/);
	assert.doesNotMatch(custom, /data-card-art="neutral"/);

	const missing = cardArtSvg({ type: 'attack' });
	const rejected = cardArtSvg({ type: 'attack', svg: '<script></script>' });
	assert.match(missing, /data-card-art="neutral"/);
	assert.match(rejected, /data-card-art="neutral"/);
});

test('numeric neutral cards show their value while other mechanics remain pictorial', () => {
	assert.match(cardArtSvg({ type: 'number', value: 7 }), />7<\/text>/);
	assert.match(cardArtSvg({ type: 'distance', value: 100 }), />100<\/text>/);
	assert.doesNotMatch(cardArtSvg({ type: 'remedy' }), /<text/);
});

test('generic faces escape package names and retain source metadata', () => {
	const html = genericCardArtHtml({ type: 'special', svg: 'M3 3h58v58z', artColor: '#2F7185' }, '<b>Name</b>');
	assert.match(html, /gcard--special/);
	assert.match(html, /data-card-art="package"/);
	assert.match(html, /--gcard-accent:#2f7185/);
	assert.match(html, /style="color:#2f7185"/);
	assert.match(html, /&lt;b&gt;Name&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<b>Name/);
});

test('artColor accepts only complete hexadecimal colours', () => {
	assert.equal(normalizeCardArtColor('#Ab12Ef'), '#ab12ef');
	assert.equal(normalizeCardArtColor('red'), null);
	assert.equal(normalizeCardArtColor('#fff'), null);
	assert.equal(normalizeCardArtColor('#ffffff;display:none'), null);
	assert.equal(cardArtStyle('url(evil)', '--accent'), '');
});

test('shared back and empty placeholder escape their optional labels', () => {
	assert.match(genericCardBackHtml('42'), /gcard__back-label">42</);
	assert.doesNotMatch(genericCardBackHtml(), /gcard__back-label/);
	assert.match(genericEmptyCardHtml('<none>'), /&lt;none&gt;/);
});
