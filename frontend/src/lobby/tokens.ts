/**
 * Token management for the lobby
 * Handles token rendering, localization and selection
 */
import { TokenKey, GameInfo } from '../models.js';
import { tokenIconHtml, packageTokenIds, packageTokenNameKey } from '../tokenIcons.js';
import { installTakenGuard } from './seats.js';

/** The tokens to offer: always the active board's own set (every board ships its pieces). */
function availableTokens(): TokenKey[] {
	return packageTokenIds();
}

/** Convert PascalCase to snake_case (e.g., RedStar -> red_star) */
export function convertTokenToSnakeCase(token: string): TokenKey {
	return token.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') as TokenKey;
}

/** Translation helper signature shared by the lobby UI (`lobby/ui.ts#t`). */
type Translate = (key: string, fallback?: string) => string;

/** The localized token name: a package token resolves its own nameKey; a built-in uses game.token_*. */
export function getTokenName(token: TokenKey, t: Translate): string {
	const pkgKey = packageTokenNameKey(token);
	if (pkgKey) return t(pkgKey, token);
	return t('game.token_' + token, token.replace('_', ' '));
}

/**
 * Render token selector in a container
 */
export function renderTokenSelector(
	container: HTMLElement,
	t: Translate,
	currentSelection?: TokenKey | null,
	usedTokens?: Set<TokenKey>
): void {
	container.innerHTML = '';
	// Name the radio GROUP so a screen reader announces "Elige tu ficha" on entry. The
	// <fieldset>/<legend> alone isn't reliably promoted to the group name by VoiceOver once a
	// <ul> list sits between them, so mark the container an explicit, labelled radiogroup and
	// strip the list semantics from the items (role="presentation") so the group isn't fragmented.
	container.setAttribute('role', 'radiogroup');
	container.setAttribute('aria-label', t('lobby.selectToken', 'Choose your piece'));
	const tokenInUseText = t('lobby.tokenInUse', '(In use)');
	const tokens = availableTokens();

	// Exactly ONE token arrives preselected, so choosing is OPTIONAL on both forms: the
	// caller's still-free previous selection wins, else the first free token. On boards
	// where the piece is a pure avatar (assembly) the player just continues; anyone who
	// cares can still change it. The submit-time "select a token" error stays as a net.
	const isFree = (tk: TokenKey) => !(usedTokens?.has(tk) ?? false);
	const chosen = currentSelection && tokens.includes(currentSelection) && isFree(currentSelection)
		? currentSelection
		: tokens.find(isFree) ?? null;

	for (const token of tokens) {
		const isUsed = usedTokens?.has(token) ?? false;
		const localizedName = getTokenName(token, t);

		const li = document.createElement('li');
		li.className = 'token-item' + (isUsed ? ' disabled' : '');
		li.setAttribute('role', 'presentation'); // don't fragment the radiogroup with list rows

		const label = document.createElement('label');
		label.className = 'token-label' + (isUsed ? ' disabled' : '');
		label.setAttribute('aria-label', localizedName + (isUsed ? ` ${tokenInUseText}` : ''));

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'token';
		input.value = token;
		input.className = 'token-radio';

		if (isUsed) {
			// Accessible unavailability: the option stays focusable and says WHY it can't
			// be picked (never the `disabled` attribute); the container's change guard
			// bounces any attempt back to a free token.
			input.setAttribute('aria-disabled', 'true');
			input.dataset.taken = '1';
		}
		input.checked = token === chosen;

		const emojiSpan = document.createElement('span');
		emojiSpan.className = 'token-emoji';
		emojiSpan.innerHTML = tokenIconHtml(token);
		emojiSpan.setAttribute('aria-hidden', 'true');

		const nameSpan = document.createElement('span');
		nameSpan.className = 'token-name';
		nameSpan.textContent = localizedName;

		if (isUsed) {
			const takenSpan = document.createElement('span');
			takenSpan.className = 'token-taken';
			takenSpan.textContent = tokenInUseText;
			nameSpan.appendChild(takenSpan);
		}

		label.appendChild(input);
		label.appendChild(emojiSpan);
		label.appendChild(nameSpan);
		li.appendChild(label);
		container.appendChild(li);
	}
	installTakenGuard(container);
}

/** Get used tokens from game players */
export function getUsedTokens(gameInfo: GameInfo): Set<TokenKey> {
	return new Set(
		gameInfo.players?.map(p => convertTokenToSnakeCase(p.token as unknown as string)) || []
	);
}
