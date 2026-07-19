import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { panelNavigator, type PanelRegion } from '../src/panelNavigator.js';

/**
 * Regression tests for the F6 / Shift+F6 landmark cycling. The cycle must be
 * cyclic (last → first forward, first → last backward) and skip regions that are
 * currently unavailable (e.g. the action bar when empty). The connection panel is
 * one more region in this ring.
 */

let announced: string[];
let announcedVars: (Record<string, unknown> | undefined)[];

function makeRegion(id: string, available = true): { region: PanelRegion; el: HTMLElement } {
	const el = document.createElement('div');
	el.id = `region-${id}`;
	el.tabIndex = -1;
	document.body.appendChild(el);
	const region: PanelRegion = {
		id,
		labelKey: `game.panels.${id}`,
		getElement: () => el,
		focus: () => { el.focus(); return true; },
		isAvailable: () => available,
	};
	return { region, el };
}

before(() => {
	setupDom();
});

beforeEach(() => {
	document.body.innerHTML = '';
	panelNavigator.reset();
	announced = [];
	announcedVars = [];
	panelNavigator.init((labelKey, vars) => { announced.push(labelKey); announcedVars.push(vars); });
});

test('next() cycles forward and wraps from the last region back to the first', () => {
	const a = makeRegion('a');
	const b = makeRegion('b');
	const c = makeRegion('c');
	[a, b, c].forEach(r => panelNavigator.register(r.region));

	a.el.focus();
	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, b.el);
	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, c.el);
	// Wrap around.
	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, a.el);
});

test('prev() cycles backward and wraps from the first region to the last', () => {
	const a = makeRegion('a');
	const b = makeRegion('b');
	const c = makeRegion('c');
	[a, b, c].forEach(r => panelNavigator.register(r.region));

	a.el.focus();
	assert.equal(panelNavigator.prev(), true);
	assert.equal(document.activeElement, c.el);
});

test('the cycle skips regions that are currently unavailable', () => {
	const a = makeRegion('a');
	const b = makeRegion('b', /* available */ false);
	const c = makeRegion('c');
	[a, b, c].forEach(r => panelNavigator.register(r.region));

	a.el.focus();
	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, c.el, 'unavailable region b is skipped');
});

test('moving into a region announces its name', () => {
	const a = makeRegion('a');
	const b = makeRegion('b');
	[a, b].forEach(r => panelNavigator.register(r.region));

	a.el.focus();
	panelNavigator.next();
	assert.deepEqual(announced, ['game.panels.b']);
});

// A region with a DYNAMIC label (the open dialog) announces it on entry — the dialog's
// title is its reason for being, and without a focus trap the player re-enters it often.
test('a region with getLabel announces the dynamic key and vars instead of labelKey', () => {
	const a = makeRegion('a');
	const dlg = makeRegion('dialog');
	dlg.region.getLabel = () => ({ key: 'game.panels.dialog_titled', vars: { title: 'Escuadrón rojo: mueve 5' } });
	[a, dlg].forEach(r => panelNavigator.register(r.region));

	a.el.focus();
	panelNavigator.next();

	assert.deepEqual(announced, ['game.panels.dialog_titled']);
	assert.deepEqual(announcedVars, [{ title: 'Escuadrón rojo: mueve 5' }]);
});
