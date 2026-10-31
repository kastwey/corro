import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvgArt } from '../src/svgArt.js';

// The server emits package art in one canonical form; the client accepts exactly that form and
// rebuilds it, so a drawing that reaches innerHTML can only contain the allowed subset.

test('canonical drawings pass through rebuilt, with attributes in canonical order', () => {
	const art = '<g opacity="0.9" transform="translate(2 3)">'
		+ '<path d="M1 1h62v62z" fill="#b33434" stroke="#fff" stroke-width="2"/>'
		+ '<circle cx="32" cy="32" r="10" fill="currentColor"/>'
		+ '<rect x="4" y="4" width="20" height="10" rx="3" fill="none" stroke="#1769aa" stroke-dasharray="4 2"/>'
		+ '<ellipse cx="40" cy="40" rx="5" ry="3" stroke-linecap="round"/>'
		+ '<line x1="0" y1="0" x2="64" y2="64" stroke="#000"/>'
		+ '<polyline points="0,0 10,10" fill="none"/>'
		+ '<polygon points="0,0 10,10 20,0" fill-rule="evenodd"/>'
		+ '</g>';
	assert.equal(sanitizeSvgArt(art), art);
	// Attribute order and whitespace are normalised, never trusted.
	assert.equal(sanitizeSvgArt('<path fill="#fff"  d="M1 1h2v2z" />'), '<path d="M1 1h2v2z" fill="#fff"/>');
});

test('legacy bare path data (games saved before colour art) is wrapped in a path', () => {
	assert.equal(sanitizeSvgArt('M3 14 h18 z'), '<path d="M3 14 h18 z"/>');
	assert.equal(sanitizeSvgArt('M0 0"/><script>alert(1)</script>'), null); // not path data once the markup is gone
	assert.equal(sanitizeSvgArt('h10'), null);
	assert.equal(sanitizeSvgArt(''), null);
	assert.equal(sanitizeSvgArt(undefined), null);
});

for (const [label, art] of [
	['a script element', '<path d="M1 1h2v2z"/><script>alert(1)</script>'],
	['a text element', '<text x="1" y="1">hi</text>'],
	['an image with href', '<image href="https://evil/x.png"/>'],
	['a use element', '<use href="#x"/>'],
	['an event handler attribute', '<path d="M1 1h2v2z" onload="alert(1)"/>'],
	['an unknown attribute', '<path d="M1 1h2v2z" id="x"/>'],
	['a style attribute', '<path d="M1 1h2v2z" style="fill:red"/>'],
	['a url() fill', '<path d="M1 1h2v2z" fill="url(#g)"/>'],
	['a named colour', '<path d="M1 1h2v2z" fill="red"/>'],
	['an upper-case hex colour (not canonical)', '<path d="M1 1h2v2z" fill="#ABC"/>'],
	['a clip-path reference', '<path d="M1 1h2v2z" clip-path="url(#c)"/>'],
	['an entity in a value', '<path d="M1 1h2v2z" fill="&#35;fff"/>'],
	['single-quoted attributes', "<path d='M1 1h2v2z'/>"],
	['text between tags', '<path d="M1 1h2v2z"/>hello'],
	['a markup fragment in a value', '<path d="M1 1h2v2z" stroke="#fff"/><path d="M1 1"><b/></path>'],
	['an unclosed group', '<g><path d="M1 1h2v2z"/>'],
	['a stray closing group', '<path d="M1 1h2v2z"/></g>'],
	['a self-closing group', '<g/>'],
	['a non-self-closing shape', '<path d="M1 1h2v2z"></path>'],
	['a group with nothing drawn', '<g transform="scale(2)"></g>'],
	['a bad transform', '<path d="M1 1h2v2z" transform="matrix(1 2 3)"/>'],
	['an opacity above one', '<path d="M1 1h2v2z" opacity="1.5"/>'],
	['a percentage length', '<rect width="50%" height="2"/>'],
	['an odd points list', '<polygon points="1,2 3"/>'],
	['a duplicated attribute', '<path d="M1 1h2v2z" d="M2 2h2v2z"/>'],
	['the upper-case SVG element', '<Path d="M1 1h2v2z"/>'],
] as const) {
	test(`rejects ${label}`, () => {
		assert.equal(sanitizeSvgArt(art), null);
	});
}
