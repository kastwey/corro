// eslint.config.mjs — static analysis for the client.
//
// The baseline is what the TypeScript ecosystem converged on: ESLint's own recommended set plus
// typescript-eslint's TYPE-CHECKED configs, which is the tier serious TS repos run — the rules that
// need the type checker (a floating promise, an unawaited async call, a comparison that is always
// false) are exactly the ones that catch real bugs rather than style opinions.
//
// Formatting is deliberately absent. typescript-eslint deprecated its formatting rules and the
// ecosystem moved that job to a formatter; mixing the two here would only produce churn and fight
// the .editorconfig the rest of the repo already follows.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		// Build output, vendored libraries and the CommonJS build scripts are not linted: the first
		// two are generated or third-party, and the scripts are Node plumbing, not app code.
		ignores: ['dist/**', 'node_modules/**', '*.js', 'websocket-test.html'],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				// A lint-only project: the build compiles src/ alone, but type-aware rules need the
				// tests in a project too or every test file fails to parse.
				project: ['./tsconfig.eslint.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// The SignalR client and i18next arrive as UMD globals typed `any`, and the server's
			// wire payloads are hand-typed in models.ts rather than generated. Treating every
			// crossing of that boundary as an error would bury the findings that matter; the
			// WireContractTests guard the shape from the other side.
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-explicit-any': 'off',

			// A DOM handler cannot return a promise, so `void doAsync()` is the correct spelling
			// and is used deliberately throughout; keep the check for genuinely ignored promises.
			'@typescript-eslint/no-confusing-void-expression': 'off',
			'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

			// node:test's `test()` returns a promise the runner owns — awaiting it is wrong, not
			// right. Named explicitly rather than switching the rule off, so a genuinely dropped
			// promise inside a test is still reported.
			'@typescript-eslint/no-floating-promises': ['error', {
				allowForKnownSafeCalls: [
					{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'before', 'after', 'beforeEach', 'afterEach'] },
				],
			}],

			// `console.debug` is the house rule for client diagnostics (AGENTS.md forbids
			// console.log in production); warn/error stay available for genuine failures.
			'no-console': ['error', { allow: ['debug', 'warn', 'error'] }],

			// A no-op arrow IS the intent for a default callback: the manager works before app.ts
			// wires the real one. Named functions and methods must still have a body.
			'@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],

			// `??` really is safer than `||` for objects, but NOT for strings here: an empty
			// select value, an empty player name and a blank translation must all fall through to
			// their default, which `??` would keep. `ignorePrimitives.string` skips exactly that
			// ambiguity and still reports the cases where `||` is simply the wrong operator.
			// ── Adoption backlog ────────────────────────────────────────────────────────────
			// These two are correct and stay ON, but their autofixer declines these particular
			// sites because the rewrite could change behaviour, and rewriting boolean logic by
			// hand across ~54 places is how a subtle bug gets in. They are WARNINGS so the gate
			// below still blocks real defects while the backlog stays visible and shrinks as the
			// files are touched — rather than being switched off and forgotten.
			'@typescript-eslint/prefer-optional-chain': 'warn',
			'@typescript-eslint/prefer-nullish-coalescing': ['warn', {
				// Numbers carry the same ambiguity as strings here: `attempt || 1` and
				// `count || fallback` mean "no useful value yet", and 0 is one of those.
				ignorePrimitives: { string: true, number: true },
			}],

			// A leading underscore is the codebase's mark for "required by the signature, unused
			// here" — a client command handler that needs no context, a callback that ignores its
			// event. The rule reports everything else.
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				caughtErrorsIgnorePattern: '^_',
			}],

			// These two read a DOM assertion as merely a null-check and rewrite it, which silently
			// drops the narrowing that matters: `querySelector(...) as HTMLElement` becomes `!`,
			// and Element has no dataset, no tabIndex, no focus. Their autofix broke twelve call
			// sites here, so the codebase keeps its explicit assertions.
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/non-nullable-type-assertion-style': 'off',
		},
	},
	{
		// Tests run on node:test through tsx: they may reach into internals and assert on shapes
		// the app never produces, so the type-aware strictness that helps in src only adds noise.
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-unnecessary-condition': 'off',
			// A stub handler that does nothing is the POINT of a stub.
			'@typescript-eslint/no-empty-function': 'off',
			// An async test body with no await is fine: the signature keeps the suite uniform.
			'@typescript-eslint/require-await': 'off',
			// Assertions interpolate whatever the fixture holds; that is the subject, not a defect.
			'@typescript-eslint/restrict-template-expressions': 'off',
			// Tests hand module functions to fakes on purpose (`t: tSync`), which is what this
			// rule flags; the app code it protects is still covered.
			'@typescript-eslint/unbound-method': 'off',
		},
	},
	{
		// The config itself is not part of the TypeScript project, so the type-aware parser has
		// no program for it. Lint it with the untyped rules rather than excluding it entirely.
		files: ['*.mjs'],
		...tseslint.configs.disableTypeChecked,
	},
);
