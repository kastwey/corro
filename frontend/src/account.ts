// account.ts — the optional player account control in the lobby header.
//
// Accounts are additive and always optional: with no provider configured this renders NOTHING, and
// every player keeps creating and joining games exactly as before. The control therefore never
// gates anything — it only reports who you are and offers to change that.
//
// The session itself lives in an HttpOnly cookie the server issues, so this module can never read
// it. That is deliberate: it means no script on the page can steal a session. The only way to learn
// whether somebody is signed in is to ask the server, which is what `fetchSession` does.

// Full, namespaced keys at every call site rather than a local prefixing helper: the translation
// parity test scans for them literally, so a key that stops existing fails the suite instead of
// silently rendering as its own name.
import { tSync } from './i18nBinder.js';
import { popupMenu } from './popupMenu.js';

/** One provider login bound to the account. The subject stays server-side: it IS the identity, and
 *  the client has no use for it. */
export interface LinkedIdentityView {
	issuer: string;
	/** The address that provider reported, so the settings screen can say WHICH account is linked. */
	email: string | null;
}

/**
 * Who may see a player in the list of who is connected. Ordered from least to most visible, and
 * each option means exactly what it says: 'Nobody' hides them from their friends too.
 */
export type PresenceVisibility = 'Nobody' | 'Friends' | 'Everyone';

const VISIBILITIES: readonly PresenceVisibility[] = ['Nobody', 'Friends', 'Everyone'];

/**
 * A visibility the server sent, or the quietest one for anything unrecognised. Guessing wrong in
 * this direction hides somebody who wanted to be seen, which they can fix; the other way round
 * publishes somebody who did not, which they cannot.
 */
export function asVisibility(value: unknown): PresenceVisibility {
	return VISIBILITIES.includes(value as PresenceVisibility)
		? value as PresenceVisibility
		: 'Nobody';
}

/**
 * Who may send a player a private message. Separate from PresenceVisibility because being findable
 * and being interruptible are different questions — somebody may be glad to be seen and still want
 * messages only from people they accepted.
 */
export type MessagePolicy = 'Nobody' | 'Friends' | 'Anyone';

const MESSAGE_POLICIES: readonly MessagePolicy[] = ['Nobody', 'Friends', 'Anyone'];

/** A policy the server sent, or the default the checkbox this replaces always meant. */
export function asMessagePolicy(value: unknown): MessagePolicy {
	return MESSAGE_POLICIES.includes(value as MessagePolicy)
		? value as MessagePolicy
		: 'Friends';
}

export interface AccountUser {
	userId: string;
	/** Null when the provider supplied no name; the caller renders a localized placeholder. */
	displayName: string | null;
	email: string | null;
	/** The public name they chose, or null while they have none. Only this is ever published in
	 *  the list of who is connected — never the display name above. */
	handle: string | null;
	/** Whether they asked to appear in that list. Off unless they turned it on. */
	/** Who may see this player in the list of who is connected. */
	visibility: PresenceVisibility;
	/** Unlock codes this account carries from device to device. */
	unlockCodes: string[];
	/** Who may send this player a private message. */
	messagePolicy: MessagePolicy;
	identities: LinkedIdentityView[];
}

export interface AccountSession {
	signedIn: boolean;
	user: AccountUser | null;
}

export const SIGNED_OUT: AccountSession = { signedIn: false, user: null };

/**
 * Reads the server's session payload defensively: an unexpected shape must degrade to "signed out"
 * rather than throw, because this runs during lobby start-up and a broken account response may not
 * take the whole lobby down with it.
 */
export function parseSession(raw: unknown): AccountSession {
	const body = raw as any;
	if (!body || typeof body !== 'object' || body.signedIn !== true || !body.user) {
		return SIGNED_OUT;
	}

	const user = body.user;
	if (typeof user.userId !== 'string' || !user.userId) {
		return SIGNED_OUT;
	}

	return {
		signedIn: true,
		user: {
			userId: user.userId,
			displayName: typeof user.displayName === 'string' && user.displayName ? user.displayName : null,
			email: typeof user.email === 'string' && user.email ? user.email : null,
			handle: typeof user.handle === 'string' && user.handle ? user.handle : null,
			visibility: asVisibility(user.visibility),
			messagePolicy: asMessagePolicy(user.messagePolicy),
			unlockCodes: Array.isArray(user.unlockCodes)
				? user.unlockCodes.filter((code: unknown): code is string => typeof code === 'string')
				: [],
			identities: Array.isArray(user.identities)
				? user.identities
					.filter((i: any) => i && typeof i.issuer === 'string' && i.issuer)
					.map((i: any) => ({
						issuer: i.issuer,
						email: typeof i.email === 'string' && i.email ? i.email : null,
					}))
				: [],
		},
	};
}

/** The provider list the server offers. Anything unexpected means "no accounts here". */
export function parseProviders(raw: unknown): string[] {
	const list = (raw as any)?.providers;
	return Array.isArray(list) ? list.filter((p: unknown) => typeof p === 'string' && !!p) : [];
}

/**
 * Where a sign-in starts. `returnUrl` comes back to us through the provider, so the server
 * re-checks that it is site-local; encoding it here keeps a path with a query string intact.
 */
export function signInPath(provider: string, returnUrl: string): string {
	return `/api/auth/signin/${encodeURIComponent(provider)}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/** Where adding a provider to the CURRENT account starts. Same navigation shape as signing in. */
export function linkPath(provider: string, returnUrl: string): string {
	return `/api/auth/link/${encodeURIComponent(provider)}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/** The provider's name as shown to players. Unknown slugs fall back to the slug itself so a newly
 *  configured provider is still usable before its label is translated. */
export function providerName(provider: string): string {
	// The key is built from the slug, so the parity scanner cannot see it. `accountProviderLabels`
	// in the account tests pins the shipped slugs instead.
	const key = `account.provider.${provider}`;
	const label = tSync(key);
	return label === key ? provider : label;
}

/**
 * The signed-in line. One flowing sentence, because a screen reader speaks it as a single line —
 * and it stays a sentence when the provider gave us no name to put in it.
 */
/**
 * What the account menu is called: the player's own name. Falls back the same way the status line
 * does, so somebody whose provider supplied no name still has something to press rather than a
 * button labelled with nothing.
 */
export function accountMenuName(session: AccountSession): string {
	const name = session.user?.displayName?.trim();
	return name && name.length > 0 ? name : tSync('account.menuLabel');
}

export function signedInText(session: AccountSession): string {
	const name = session.user?.displayName;
	return name ? tSync('account.signedInAs', { name }) : tSync('account.signedIn');
}

/** Fetches the provider list; a failure means the control simply does not appear. */
export async function fetchProviders(fetchImpl: typeof fetch): Promise<string[]> {
	try {
		const response = await fetchImpl('/api/auth/providers');
		if (!response.ok) return [];
		return parseProviders(await response.json());
	} catch {
		return [];
	}
}

/** Asks the server who we are. A failure reads as signed out, never as an error state. */
export async function fetchSession(fetchImpl: typeof fetch): Promise<AccountSession> {
	try {
		const response = await fetchImpl('/api/auth/me');
		if (!response.ok) return SIGNED_OUT;
		return parseSession(await response.json());
	} catch {
		return SIGNED_OUT;
	}
}

/**
 * The session, or NULL when the question could not be asked.
 *
 * The difference matters wherever "signed out" causes something to happen. fetchSession answers a
 * failed request with SIGNED_OUT, which is fine for painting a bar — it shows the sign-in links,
 * and the next read corrects it — and wrong for anything that ACTS on the answer: a hiccup on one
 * request would throw somebody out of the screen they had just opened.
 */
export async function readSession(fetchImpl: typeof fetch): Promise<AccountSession | null> {
	try {
		const response = await fetchImpl('/api/auth/me');
		if (response.status === 401) return SIGNED_OUT;
		if (!response.ok) return null;
		return parseSession(await response.json());
	} catch {
		return null;
	}
}

/** Ends the session. A POST, so the Lax session cookie cannot be dropped by a cross-site link. */
export async function signOut(fetchImpl: typeof fetch): Promise<boolean> {
	try {
		const response = await fetchImpl('/api/auth/signout', { method: 'POST' });
		return response.ok;
	} catch {
		return false;
	}
}

/** The longest name the server accepts. Mirrors `UserAccountService.MaxDisplayNameLength`. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * Outcome codes shared with the server. `ok` means the operation applied; everything else names a
 * specific reason the client turns into a translated sentence.
 */
export type AccountOperationResult =
	| 'ok'
	| 'last_sign_in_method'
	| 'not_linked'
	| 'name_too_long'
	| 'signed_out'
	| 'failed';

/** Removes a provider from the account. A POST because it changes account state. */
export async function unlinkProvider(
	fetchImpl: typeof fetch,
	provider: string,
): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl(`/api/auth/unlink/${encodeURIComponent(provider)}`, { method: 'POST' });
		if (response.ok) return 'ok';
		// 409 is the guard against leaving an account with no way back into it — a refusal with a
		// reason, not a transient failure to retry.
		if (response.status === 409) return 'last_sign_in_method';
		if (response.status === 404) return 'not_linked';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

/** Sets the name other players see. A blank name clears it back to the localized placeholder. */
export async function renameAccount(
	fetchImpl: typeof fetch,
	displayName: string,
): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl('/api/auth/me', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName }),
		});
		if (response.ok) return 'ok';
		if (response.status === 400) return 'name_too_long';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

/** What came of trying to set a handle: either it is yours, or the reason it is not. */
export interface HandleSaveResult {
	readonly ok: boolean;
	/** A key under account.settings.* — each refusal is its own thing to say. */
	readonly code: string;
	readonly vars?: Record<string, unknown>;
}

/**
 * Claim a public name, or change to another one. POST rather than PATCH-on-me because it is its
 * own operation with its own refusals: taken, too soon, or not a usable name at all.
 */
export async function saveHandle(
	fetchImpl: typeof fetch,
	handle: string,
): Promise<HandleSaveResult> {
	try {
		const response = await fetchImpl('/api/auth/handle', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ handle }),
		});
		if (response.ok) return { ok: true, code: 'handleSaved' };
		if (response.status === 401) return { ok: false, code: 'signedOut' };

		const body = await response.json().catch(() => ({})) as { code?: string; changeableAtUtc?: string };
		switch (body.code) {
			case 'HANDLE_TAKEN': return { ok: false, code: 'handleTaken' };
			case 'HANDLE_TOO_SOON': return {
				ok: false,
				code: 'handleTooSoon',
				// The date is the useful half: "not yet" without "until when" is just a refusal.
				vars: { date: formatDate(body.changeableAtUtc) },
			};
			case 'HANDLE_TOOSHORT': return { ok: false, code: 'handleTooShort' };
			case 'HANDLE_TOOLONG': return { ok: false, code: 'handleTooLong' };
			case 'HANDLE_RESERVED': return { ok: false, code: 'handleReserved' };
			default: return { ok: false, code: 'handleBadCharacters' };
		}
	} catch {
		return { ok: false, code: 'handleFailed' };
	}
}

/** A date somebody can read, in their own language; empty when the server sent nothing usable. */
function formatDate(iso?: string): string {
	if (!iso) return '';
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ''
		: date.toLocaleDateString(document.documentElement.lang || undefined, {
			year: 'numeric', month: 'long', day: 'numeric',
		});
}

/**
 * Hands the account the unlock codes this browser holds, and returns everything it holds
 * afterwards. Additive: nothing is ever removed, here or on the server.
 *
 * This is what makes a code typed months ago on a laptop reveal the same board on a phone — the
 * same bargain signing in already makes for the tables this browser was holding.
 */
export async function adoptUnlockCodes(
	fetchImpl: typeof fetch, codes: readonly string[],
): Promise<string[]> {
	if (codes.length === 0) return [];
	try {
		const response = await fetchImpl('/api/auth/unlock-codes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ codes }),
		});
		if (!response.ok) return [];
		const payload = await response.json() as { unlockCodes?: unknown };
		return Array.isArray(payload.unlockCodes)
			? payload.unlockCodes.filter((c: unknown): c is string => typeof c === 'string')
			: [];
	} catch {
		return [];
	}
}

/** Who may write to this player. True when the server stored the choice. */
export async function saveMessagePolicy(
	fetchImpl: typeof fetch, policy: MessagePolicy,
): Promise<boolean> {
	try {
		const response = await fetchImpl('/api/auth/message-policy', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ policy }),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Who may see this player connected. True when the server stored the choice. */
export async function saveVisibility(
	fetchImpl: typeof fetch, visibility: PresenceVisibility,
): Promise<boolean> {
	try {
		const response = await fetchImpl('/api/auth/visibility', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ visibility }),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/** Erases the account and every provider mapping pointing at it. */
export async function deleteAccount(fetchImpl: typeof fetch): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl('/api/auth/me', { method: 'DELETE' });
		if (response.ok) return 'ok';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

export interface AccountBarOptions {
	/** Injected so tests can drive the control without a network. */
	fetchImpl?: typeof fetch;
	/** Where the provider should send the player back to. */
	returnUrl?: string;
	/** Whether the previous attempt came back as a failure (the server's `?signInError=1`). */
	signInFailed?: boolean;
	/** Called after a successful sign-out so the host page can refresh what it shows. */
	onSignedOut?: () => void;
	/** Opens the account settings. Injected rather than imported so this module stays free of the
	 *  dialog layer; when absent, no management affordance is offered at all. */
	onManageAccount?: () => void;
}

/**
 * Renders the account control into `mount`, and returns the session it found.
 *
 * The sign-in affordances are LINKS, not buttons: they navigate away to the provider, and telling a
 * screen-reader user "button" for something that leaves the page is a lie. Sign-out is a real
 * button, because it posts.
 */
export async function initAccountBar(
	mount: HTMLElement,
	options: AccountBarOptions = {},
): Promise<AccountSession> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const returnUrl = options.returnUrl ?? '/';

	const providers = await fetchProviders(fetchImpl);
	if (providers.length === 0) {
		// This deployment configured no provider: no account UI at all.
		mount.replaceChildren();
		mount.hidden = true;
		return SIGNED_OUT;
	}

	let session = await fetchSession(fetchImpl);
	mount.hidden = false;

	const render = () => {
		mount.replaceChildren();

		if (options.signInFailed && !session.signedIn) {
			// role="alert" because it explains why an action the player just took produced nothing.
			// It also says they can carry on without an account, so it never reads as a dead end.
			const failure = document.createElement('p');
			failure.className = 'account-error';
			failure.setAttribute('role', 'alert');
			failure.textContent = tSync('account.signInFailed');
			mount.appendChild(failure);
		}

		if (session.signedIn) {
			const status = document.createElement('p');
			status.className = 'account-status';
			status.textContent = signedInText(session);
			mount.appendChild(status);

			const signOutAndRefresh = async () => {
				if (await signOut(fetchImpl)) {
					session = SIGNED_OUT;
					render();
					options.onSignedOut?.();
				}
			};

			// One control rather than two side by side: the player's own name, opening the small
			// set of things that are about THEM. Two buttons sitting in the header is two tab stops
			// somebody passes on the way to everything else, every time.
			const menuButton = document.createElement('button');
			menuButton.type = 'button';
			menuButton.id = 'account-manage-btn';
			menuButton.className = 'secondary-button account-manage-btn';
			menuButton.setAttribute('aria-haspopup', 'menu');
			menuButton.textContent = accountMenuName(session);
			menuButton.addEventListener('click', () => {
				popupMenu.open({
					ariaLabel: tSync('account.menuLabel'),
					anchor: menuButton,
					items: [
						...(options.onManageAccount
							? [{
								label: tSync('account.settingsMenu'),
								onSelect: () => options.onManageAccount!(),
							}]
							: []),
						{
							label: tSync('account.signOut'),
							onSelect: () => void signOutAndRefresh(),
						},
					],
					onClose: () => menuButton.focus(),
				});
			});
			mount.appendChild(menuButton);

			return;
		}

		const prompt = document.createElement('p');
		prompt.className = 'account-prompt';
		prompt.id = 'account-prompt';
		prompt.textContent = tSync('account.signInPrompt');
		mount.appendChild(prompt);

		// A LIST, because that is what these are: one way in per provider, and how many there are is
		// worth knowing before you start through them ("list, 2 items"). A role="group" named them
		// as a set but could not count them. Named from the prompt above it, so entering the list
		// says what it is for. `role="list"` is explicit because `list-style: none` makes browsers
		// drop the semantics, and the layout needs it.
		//
		// LINKS, not buttons, and deliberately: signing in is a full page navigation to the
		// provider, so it must behave like one — middle-click, open in a new tab, and the status bar
		// showing where it goes.
		const list = document.createElement('ul');
		list.className = 'account-providers';
		list.setAttribute('role', 'list');
		list.setAttribute('aria-labelledby', prompt.id);

		for (const provider of providers) {
			const item = document.createElement('li');
			const link = document.createElement('a');
			link.className = 'account-signin-link';
			link.dataset.provider = provider;
			link.href = signInPath(provider, returnUrl);
			link.textContent = tSync('account.signInWith', { provider: providerName(provider) });
			item.appendChild(link);
			list.appendChild(item);
		}

		mount.appendChild(list);
	};

	render();
	// No `languageChanged` listener: there is no runtime language change to hear. Each language is
	// served as its own pre-translated page and choosing one is a navigation, so this rendered once
	// in the right language or not at all (see i18nBinder.ts).
	return session;
}
