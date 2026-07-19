import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import {
	propertyInfoDialog,
	projectPropertyInfo,
	propertyInfoLines,
	type PropertyInfoData,
} from '../src/propertyInfoDialog.js';
import type { Square, Player } from '../src/models.js';

/**
 * Tests for the property-info modal (bug 9). The projection + the accessible line builder
 * are DOM-free pure helpers; the dialog test reuses the shared jsdom + fake-i18next harness
 * and asserts the native modal <dialog>, the labelled info rows and Escape/close teardown.
 */

function sq(id: number, over: Partial<Square>): Square {
	return { id, name: `Sq${id}`, x: 0, y: 0, ...over };
}
function player(id: string, name: string): Player {
	return { id, name } as Player;
}

const SQUARES: Square[] = [
	sq(0, { name: 'Go', type: 'corner' }),
	sq(1, { name: 'Brown 1', type: 'property', color: 'brown', groupNameKey: 'game.color_brown', price: 60, rent: [2, 10, 30, 90, 160, 250], ownerId: 'me' }),
	sq(2, { name: 'Brown 2', type: 'property', color: 'brown', groupNameKey: 'game.color_brown', price: 60, rent: [4, 20, 60, 180, 320, 450], ownerId: 'me' }),
	sq(3, { name: 'Station', type: 'railroad', price: 200, ownerId: 'p2', mortgaged: true }),
];
const PLAYERS: Player[] = [player('me', 'Me'), player('p2', 'Bob')];

// ── Pure helpers ────────────────────────────────────────────────────────────

test('projectPropertyInfo resolves owner, whole-group ownership and buildings', () => {
	const d = projectPropertyInfo(SQUARES, 1, PLAYERS, 'me')!;
	assert.equal(d.name, 'Brown 1');
	assert.equal(d.color, 'brown');
	assert.equal(d.groupNameKey, 'game.color_brown'); // carried through so the dialog can read the group name
	assert.equal(d.price, 60);
	assert.equal(d.ownerName, 'Me');
	assert.equal(d.ownedByMe, true);
	assert.equal(d.ownsWholeGroup, true); // I own both brown squares
	assert.deepEqual(d.rent, [2, 10, 30, 90, 160, 250]);
});

test('projectPropertyInfo marks another owner, no full group, mortgaged', () => {
	const d = projectPropertyInfo(SQUARES, 3, PLAYERS, 'me')!;
	assert.equal(d.ownerName, 'Bob');
	assert.equal(d.ownedByMe, false);
	assert.equal(d.ownsWholeGroup, false); // railroad has no colour group
	assert.equal(d.mortgaged, true);
});

test('projectPropertyInfo returns null for an out-of-range index', () => {
	assert.equal(projectPropertyInfo(SQUARES, 99, PLAYERS, 'me'), null);
});

const translate = (k: string, v?: Record<string, any>) => {
	switch (k) {
		case 'color_brown': return 'Brown';
		case 'property_info_price': return `Price: ${v!.price} euros`;
		case 'property_info_tax': return `Tax to pay: ${v!.price} euros`;
		case 'property_info_owner': return `Owner: ${v!.owner}`;
		case 'property_info_owner_self': return 'You own this property';
		case 'you_own_whole_group': return 'You own the whole colour group';
		case 'property_info_group_owned': return `${v!.owner} owns the whole colour group`;
		case 'property_info_unowned': return 'Unowned';
		case 'hotel_label': return 'Hotel';
		case 'houses_count': return `${v!.count} house(s)`;
		case 'mortgaged_label': return 'Mortgaged';
		case 'property_info_rent_base': return `Base rent: ${v!.amount} euros`;
		case 'property_info_rent_houses': return `Rent with ${v!.count} house(s): ${v!.amount} euros`;
		case 'property_info_rent_hotel': return `Rent with hotel: ${v!.amount} euros`;
		case 'property_info_rent_railroad': return `Rent with ${v!.count} station(s) owned: ${v!.amount} euros`;
		case 'property_info_rent_utility_one': return 'With one utility owned: 4 times the dice roll';
		case 'property_info_rent_utility_both': return 'With both utilities owned: 10 times the dice roll';
		case 'property_info_no_details': return 'No additional information for this space.';
		default: return k;
	}
};

// The group line is produced by squareGroupLabel in production; here a small fake keeps the pure
// line tests deterministic and independent of i18next ("Group: <colour name>").
const groupLabel = (d: Pick<PropertyInfoData, 'groupNameKey' | 'color'>): string =>
	(d.groupNameKey || d.color) ? `Group: ${translate('color_' + d.color)}` : '';

test('propertyInfoLines reads a street I fully own, with its rent table', () => {
	const d: PropertyInfoData = {
		name: 'Brown 1', color: 'brown', groupNameKey: 'game.color_brown', price: 60, rent: [2, 10, 30, 90, 160, 250],
		ownerName: 'Me', ownedByMe: true, ownsWholeGroup: true, smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	assert.deepEqual(propertyInfoLines(d, translate, groupLabel), [
		'Group: Brown',
		'Price: 60 euros',
		'You own this property',
		'You own the whole colour group',
		'Base rent: 2 euros',
		'Rent with 1 house(s): 10 euros',
		'Rent with 2 house(s): 30 euros',
		'Rent with 3 house(s): 90 euros',
		'Rent with 4 house(s): 160 euros',
		'Rent with hotel: 250 euros',
	]);
});

test('propertyInfoLines shows a tax square as a tax to pay, not a price/owner', () => {
	const tax: PropertyInfoData = {
		name: 'Galactic Luxury Tax', type: 'tax', amount: 200,
		ownedByMe: false, ownsWholeGroup: false, smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	// Only the tax line — no colour, "Price", owner or "Unowned" rows.
	assert.deepEqual(propertyInfoLines(tax, translate), ['Tax to pay: 200 euros']);
});

test('propertyInfoLines reads an unowned ownable square and a hotel + mortgage', () => {
	const unowned: PropertyInfoData = {
		name: 'Brown 1', color: 'brown', groupNameKey: 'game.color_brown', price: 60, rent: [2, 10, 30, 90, 160, 250],
		ownerName: undefined, ownedByMe: false, ownsWholeGroup: false, smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	assert.equal(propertyInfoLines(unowned, translate, groupLabel)[2], 'Unowned');

	const built: PropertyInfoData = {
		name: 'Brown 2', color: 'brown', groupNameKey: 'game.color_brown', price: 60, rent: [4, 20, 60, 180, 320, 450],
		ownerName: 'Bob', ownedByMe: false, ownsWholeGroup: true, smallBuildings: 0, bigBuildings: 1, mortgaged: true,
	};
	const lines = propertyInfoLines(built, translate, groupLabel);
	assert.deepEqual(lines.slice(0, 5), [
		'Group: Brown',
		'Price: 60 euros',
		'Owner: Bob',
		'Bob owns the whole colour group',
		'Hotel',
	]);
	assert.equal(lines[5], 'Mortgaged');
});

test('propertyInfoLines falls back to a no-details note for a non-ownable space', () => {
	const go: PropertyInfoData = {
		name: 'Go', ownerName: undefined, ownedByMe: false, ownsWholeGroup: false,
		smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	assert.deepEqual(propertyInfoLines(go, translate), ['No additional information for this space.']);
});

test('propertyInfoLines shows the station rent ladder by number of stations owned', () => {
	const station: PropertyInfoData = {
		name: 'Central Station', type: 'railroad', price: 200,
		ownerName: undefined, ownedByMe: false, ownsWholeGroup: false,
		smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	assert.deepEqual(propertyInfoLines(station, translate), [
		'Price: 200 euros',
		'Unowned',
		'Rent with 1 station(s) owned: 25 euros',
		'Rent with 2 station(s) owned: 50 euros',
		'Rent with 3 station(s) owned: 100 euros',
		'Rent with 4 station(s) owned: 200 euros',
	]);
});

test('propertyInfoLines describes the utility dice-multiplier rent rule', () => {
	const utility: PropertyInfoData = {
		name: 'Electric Company', type: 'utility', price: 150,
		ownerName: 'Bob', ownedByMe: false, ownsWholeGroup: false,
		smallBuildings: 0, bigBuildings: 0, mortgaged: false,
	};
	assert.deepEqual(propertyInfoLines(utility, translate), [
		'Price: 150 euros',
		'Owner: Bob',
		'With one utility owned: 4 times the dice roll',
		'With both utilities owned: 10 times the dice roll',
	]);
});

// ── Dialog (jsdom) ────────────────────────────────────────────────────────────

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	if (propertyInfoDialog.isOpen()) propertyInfoDialog.close();
});

function open(index = 1): void {
	propertyInfoDialog.open({
		getData: () => projectPropertyInfo(SQUARES, index, PLAYERS, 'me')!,
	});
}

test('renders a native modal <dialog> titled with the square and one row per info line', () => {
	open(1);
	const dialog = document.getElementById('property-info-dialog') as HTMLDialogElement;
	assert.ok(dialog);
	assert.equal(dialog.tagName, 'DIALOG');
	assert.equal(dialog.open, true);
	// Operated in focus mode (roving-tabindex info lines): an application surface so the
	// screen reader keeps its virtual cursor off and arrow keys drive the line navigation.
	assert.equal(dialog.getAttribute('role'), null);
	const application = dialog.querySelector('.property-info-application')!;
	assert.equal(application.getAttribute('role'), 'application');
	assert.equal(application.getAttribute('aria-labelledby'), 'property-info-title');
	assert.equal(dialog.querySelector('.property-info-panel__header')?.tagName, 'DIV');
	assert.equal(dialog.getAttribute('aria-modal'), null);
	assert.equal(dialog.getAttribute('aria-labelledby'), 'property-info-title');
	assert.equal(document.getElementById('property-info-title')!.textContent, 'Brown 1');

	const rows = Array.from(document.querySelectorAll('.property-info-item')) as HTMLElement[];
	assert.ok(rows.length >= 4);
	assert.equal(rows[0].getAttribute('role'), 'listitem');
	assert.equal(rows[0].getAttribute('aria-label'), 'Group: Brown');
	// The visible text is hidden from the reader to avoid a double read.
	assert.equal(rows[0].querySelector('.property-info-item__text')!.getAttribute('aria-hidden'), 'true');
	// Exactly one tab stop (roving tabindex).
	assert.equal(rows.filter(r => r.tabIndex === 0).length, 1);
});

test('Escape and the close button tear the dialog down', () => {
	open(1);
	const dialog = document.getElementById('property-info-dialog') as HTMLDialogElement;
	const esc = new (globalThis as any).window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
	dialog.dispatchEvent(esc);
	assert.equal(document.getElementById('property-info-dialog'), null);
	assert.equal(propertyInfoDialog.isOpen(), false);

	open(3);
	(document.querySelector('.property-info-panel__close') as HTMLButtonElement).click();
	assert.equal(document.getElementById('property-info-dialog'), null);
});

test('opening for a new square replaces the previous dialog', () => {
	open(1);
	assert.equal(document.getElementById('property-info-title')!.textContent, 'Brown 1');
	open(3);
	assert.equal(document.querySelectorAll('#property-info-dialog').length, 1);
	assert.equal(document.getElementById('property-info-title')!.textContent, 'Station');
});
