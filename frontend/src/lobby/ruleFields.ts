// ruleFields.ts — the single source of truth mapping the "Game rules" panel inputs to GameSettings.
//
// The lobby used to hardcode this correspondence TWICE (write settings → panel, read panel → settings),
// so adding a rule meant editing both in lockstep. One declarative table drives both directions; the
// pure read/apply helpers below are DOM-free (the caller injects the getters/setters), so they unit-test.

import type { GameSettings } from '../models.js';

type NumField = { id: string; key: keyof GameSettings; kind: 'num'; def: number };
type BoolField = { id: string; key: keyof GameSettings; kind: 'bool' };
export type RuleField = NumField | BoolField;

/** Every host-editable rule: its input id, the GameSettings key it maps to, and (for numbers) the default. */
export const RULE_FIELDS: readonly RuleField[] = [
	{ id: 'rule-starting-money', key: 'startingMoney', kind: 'num', def: 1500 },
	{ id: 'rule-go-bonus', key: 'goBonus', kind: 'num', def: 200 },
	{ id: 'rule-double-go', key: 'doubleGoSalary', kind: 'bool' },
	{ id: 'rule-auction-on-decline', key: 'auctionOnDecline', kind: 'bool' },
	{ id: 'rule-building-shortage', key: 'buildingShortage', kind: 'bool' },
	{ id: 'rule-even-build', key: 'evenBuildRule', kind: 'bool' },
	{ id: 'rule-no-build-first-lap', key: 'noBuildingFirstLap', kind: 'bool' },
	{ id: 'rule-mortgage-interest', key: 'mortgageInterestRate', kind: 'num', def: 10 },
	{ id: 'rule-holding-release-cost', key: 'holdingReleaseCost', kind: 'num', def: 50 },
	{ id: 'rule-max-holding-turns', key: 'maxHoldingTurns', kind: 'num', def: 3 },
	{ id: 'rule-collect-rent-holding', key: 'collectRentWhileHeld', kind: 'bool' },
	{ id: 'rule-free-parking', key: 'freeParkingJackpot', kind: 'bool' },
	{ id: 'rule-auction-timeout', key: 'auctionBidTimeoutSeconds', kind: 'num', def: 20 },
];

/**
 * Build a GameSettings from the panel. `readValue` returns an input's raw string (or undefined when
 * absent/empty → the field's default); `readChecked` returns a checkbox state. DOM-free for testing.
 */
export function readRuleSettings(
	readValue: (id: string) => string | undefined,
	readChecked: (id: string) => boolean,
): GameSettings {
	const out: Record<string, unknown> = {};
	for (const f of RULE_FIELDS) {
		if (f.kind === 'num') {
			const raw = readValue(f.id);
			const value = raw === undefined || raw === '' ? NaN : Number(raw);
			out[f.key] = Number.isFinite(value) ? value : f.def;
		} else {
			out[f.key] = readChecked(f.id);
		}
	}
	return out as GameSettings;
}

/**
 * Push a GameSettings into the panel via the injected setters. A numeric value is only written when
 * present (a package that omits a rule leaves the panel's own default), mirroring the previous behaviour.
 */
export function applyRuleSettings(
	s: GameSettings,
	setValue: (id: string, value: number) => void,
	setChecked: (id: string, value: boolean) => void,
): void {
	for (const f of RULE_FIELDS) {
		if (f.kind === 'num') {
			const v = s[f.key] as number | undefined | null;
			if (v !== undefined && v !== null) setValue(f.id, v);
		} else {
			setChecked(f.id, !!s[f.key]);
		}
	}
}
