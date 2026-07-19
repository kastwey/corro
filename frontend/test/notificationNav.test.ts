import test from 'node:test';
import assert from 'node:assert/strict';
import { nextListFocus as nextNotificationFocus, type ListFocus as NotifFocus } from '../src/accessibleList.js';

/**
 * Pure keyboard-navigation model shared by the notifications panel and the manage
 * dialog (RovingToolbarList). Two levels: moving between items ('item') and moving
 * inside an item's action toolbar ('toolbar'). These tests pin the model without DOM.
 */

// Two notifications: #0 has 1 toolbar button (close), #1 has 2 (custom + close).
const toolbarCounts = (i: number) => [1, 2][i] ?? 0;

test('item level: Down/Up move between notifications and clamp at the ends', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 0 }, 'ArrowDown', false, 2, toolbarCounts), { level: 'item', item: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 1 }, 'ArrowDown', false, 2, toolbarCounts), { level: 'item', item: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 1 }, 'ArrowUp', false, 2, toolbarCounts), { level: 'item', item: 0 });
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 0 }, 'ArrowUp', false, 2, toolbarCounts), { level: 'item', item: 0 });
});

test('item level: Home/End jump to first/last notification', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 1 }, 'Home', false, 2, toolbarCounts), { level: 'item', item: 0 });
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 0 }, 'End', false, 2, toolbarCounts), { level: 'item', item: 1 });
});

test('item level: Right enters the toolbar only when there are actions', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 0 }, 'ArrowRight', false, 2, toolbarCounts), { level: 'toolbar', item: 0, button: 0 });
	// A notification with no toolbar buttons does not trap focus.
	assert.equal(nextNotificationFocus({ level: 'item', item: 0 }, 'ArrowRight', false, 1, () => 0), null);
});

test('toolbar level: Right/Left move between buttons and clamp', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 0 }, 'ArrowRight', false, 2, toolbarCounts), { level: 'toolbar', item: 1, button: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 1 }, 'ArrowRight', false, 2, toolbarCounts), { level: 'toolbar', item: 1, button: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 1 }, 'ArrowLeft', false, 2, toolbarCounts), { level: 'toolbar', item: 1, button: 0 });
});

test('toolbar level: Left past the first button (and Escape) returns to the notification', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 0 }, 'ArrowLeft', false, 2, toolbarCounts), { level: 'item', item: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 1 }, 'Escape', false, 2, toolbarCounts), { level: 'item', item: 1 });
});

test('toolbar level: Up/Down leave the toolbar and move between notifications', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 1 }, 'ArrowUp', false, 2, toolbarCounts), { level: 'item', item: 0 });
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 0, button: 0 }, 'ArrowDown', false, 2, toolbarCounts), { level: 'item', item: 1 });
});

test('ContextMenu key and Shift+F10 request the actions menu from either level', () => {
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 0 }, 'ContextMenu', false, 2, toolbarCounts), { action: 'openMenu', item: 0 });
	assert.deepEqual(nextNotificationFocus({ level: 'item', item: 1 }, 'F10', true, 2, toolbarCounts), { action: 'openMenu', item: 1 });
	assert.deepEqual(nextNotificationFocus({ level: 'toolbar', item: 1, button: 0 }, 'ContextMenu', false, 2, toolbarCounts), { action: 'openMenu', item: 1 });
});

test('unrelated keys and an empty list are ignored', () => {
	assert.equal(nextNotificationFocus({ level: 'item', item: 0 }, 'a', false, 2, toolbarCounts), null);
	assert.equal(nextNotificationFocus({ level: 'item', item: 0 } as NotifFocus, 'ArrowDown', false, 0, toolbarCounts), null);
});
