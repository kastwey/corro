import test from 'node:test';
import assert from 'node:assert/strict';
import { RULE_FIELDS, readRuleSettings, applyRuleSettings } from '../src/lobby/ruleFields.js';
import type { GameSettings } from '../src/models.js';

// The rule table is the single source of truth for the panel<->settings mapping. These pin its two
// directions (read the panel into settings; apply settings onto the panel) and the number defaults.

test('readRuleSettings reads every field from the panel values', () => {
	const values: Record<string, string> = {
		'rule-starting-money': '2500', 'rule-go-bonus': '300', 'rule-mortgage-interest': '5',
		'rule-holding-release-cost': '75', 'rule-max-holding-turns': '2', 'rule-auction-timeout': '10',
	};
	const checked: Record<string, boolean> = { 'rule-double-go': true };

	const s = readRuleSettings(id => values[id], id => checked[id] ?? false);

	assert.equal(s.startingMoney, 2500);
	assert.equal(s.goBonus, 300);
	assert.equal(s.mortgageInterestRate, 5);
	assert.equal(s.holdingReleaseCost, 75);
	assert.equal(s.maxHoldingTurns, 2);
	assert.equal(s.auctionBidTimeoutSeconds, 10);
	assert.equal(s.doubleGoSalary, true);
	assert.equal(s.auctionOnDecline, false); // unchecked -> false
});

test('readRuleSettings falls back to each number field default when absent or empty', () => {
	const s = readRuleSettings(id => (id === 'rule-holding-release-cost' ? '' : undefined), () => false);
	assert.equal(s.startingMoney, 1500);
	assert.equal(s.goBonus, 200);
	assert.equal(s.mortgageInterestRate, 10);
	assert.equal(s.holdingReleaseCost, 50);   // empty string -> default
	assert.equal(s.maxHoldingTurns, 3);
	assert.equal(s.auctionBidTimeoutSeconds, 20);
});

test('applyRuleSettings writes each field onto the panel; omitted numbers are left untouched', () => {
	const nums: Record<string, number> = {};
	const bools: Record<string, boolean> = {};
	const s = {
		startingMoney: 2000, auctionBidTimeoutSeconds: 15,
		freeParkingJackpot: true, collectRentWhileHeld: true,
		// goBonus etc. intentionally omitted -> their inputs must NOT be written
	} as unknown as GameSettings;

	applyRuleSettings(s, (id, v) => { nums[id] = v; }, (id, v) => { bools[id] = v; });

	assert.equal(nums['rule-starting-money'], 2000);
	assert.equal(nums['rule-auction-timeout'], 15);
	assert.ok(!('rule-go-bonus' in nums), 'an omitted numeric rule is not written to the panel');
	assert.equal(bools['rule-free-parking'], true);
	assert.equal(bools['rule-collect-rent-holding'], true);
	assert.equal(bools['rule-double-go'], false); // omitted bool -> false written
});

test('a settings object round-trips through apply then read unchanged', () => {
	const original: GameSettings = {
		startingMoney: 1800, goBonus: 250, doubleGoSalary: true, auctionOnDecline: false,
		buildingShortage: true, evenBuildRule: false, noBuildingFirstLap: true,
		mortgageInterestRate: 12, holdingReleaseCost: 60, maxHoldingTurns: 4, collectRentWhileHeld: true,
		freeParkingJackpot: true, auctionBidTimeoutSeconds: 25,
	};
	const nums: Record<string, string> = {};
	const bools: Record<string, boolean> = {};
	applyRuleSettings(original, (id, v) => { nums[id] = String(v); }, (id, v) => { bools[id] = v; });

	const readBack = readRuleSettings(id => nums[id], id => bools[id] ?? false);
	assert.deepEqual(readBack, original);
});

test('the table covers exactly the host-editable GameSettings keys, with no duplicates', () => {
	const ids = RULE_FIELDS.map(f => f.id);
	const keys = RULE_FIELDS.map(f => f.key);
	assert.equal(new Set(ids).size, ids.length, 'no duplicate input ids');
	assert.equal(new Set(keys).size, keys.length, 'no duplicate settings keys');
	assert.equal(RULE_FIELDS.length, 13);
});
