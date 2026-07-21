// i18nBinder.ts - Automatic translation system with i18next
// Support for import and UMD

declare global {
  interface Window {
	i18next: any;
  }
}

export interface I18nConfig {
  defaultLanguage: string;
  supportedLanguages: string[];
  resourcesPath: string;
}

const unsafeTranslationKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Copies a package translation tree while dropping keys that can mutate object prototypes. */
export function sanitizePackageTranslations(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const safe: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
	if (unsafeTranslationKeys.has(key)) continue;
	if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
	  safe[key] = child;
	} else if (child && typeof child === 'object' && !Array.isArray(child)) {
	  safe[key] = sanitizePackageTranslations(child);
	}
  }
  return safe;
}

export class I18nBinder {
  private initialized = false;
  private currentLanguage = 'en';
  private i18next: any = null;
  private readonly LANGUAGE_COOKIE = 'corro_language';

  /**
   * The active board's currency symbol, used by the `money` interpolation formatter
   * (`{{amount, money}}`). Defaults to "€" until a board loads (lobby/pre-game).
   */
  private moneySymbol = '€';
  /**
   * Board-vocabulary variables made available to EVERY translation (the currency symbol and the
   * board's terminology: holding, free parking, transit, utility…). Merged into both tSync() and the
   * data-i18n DOM path so a generic app string can say "{{holding}}"/"{{currency}}" and get the board's
   * own word without any per-board announcement override. Set via {@link setBoardContext}.
   */
  private defaultVars: Record<string, string> = { currency: '€', currencyName: 'euros' };

  /**
   * Installs the active board's vocabulary so every translation resolves `{{currency}}`, the
   * `money` formatter, and the terminology variables ({{holding}}, {{transit}}…). Caller derives the
   * values from the game state (see boardVocabulary.ts); passing `undefined` keeps the default.
   */
  setBoardContext(moneySymbol: string, vars: Record<string, string>): void {
	this.moneySymbol = moneySymbol || '€';
	this.defaultVars = { ...vars, currency: this.moneySymbol };
  }

  /** Formats an amount with the active board's currency symbol (the `money` interpolation format). */
  private formatMoney(value: unknown): string {
	return `${value}${this.moneySymbol}`;
  }

  /** Public money formatter for strings built in TS (not via i18n), e.g. board square labels. */
  money(value: number | string): string {
	return this.formatMoney(value);
  }

	/** Formats a number with the active UI locale (English is the source/default locale). */
	formatNumber(value: number): string {
	return value.toLocaleString(this.currentLanguage);
	}
  
  constructor(private config: I18nConfig = {
	defaultLanguage: 'en',
	supportedLanguages: ['en', 'es'],
	resourcesPath: 'i18n/locales'
  }) {}

  /**
   * Gets the language from cookie
   */
  private getLanguageFromCookie(): string | null {
	const cookies = document.cookie.split(';');
	for (const cookie of cookies) {
	  const [name, value] = cookie.trim().split('=');
	  if (name === this.LANGUAGE_COOKIE) {
		return decodeURIComponent(value);
	  }
	}
	return null;
  }

  /**
   * Saves the language to cookie (valid for 1 year)
   */
  private saveLanguageToCookie(language: string): void {
	const expires = new Date();
	expires.setFullYear(expires.getFullYear() + 1);
	document.cookie = `${this.LANGUAGE_COOKIE}=${encodeURIComponent(language)}; expires=${expires.toUTCString()}; path=/`;
  }

  /**
   * Detects the initial language: cookie > browser > default
   */
  private detectInitialLanguage(): string {
	// 1. First check cookie
	const cookieLanguage = this.getLanguageFromCookie();
	if (cookieLanguage && this.config.supportedLanguages.includes(cookieLanguage)) {
	  return cookieLanguage;
	}

	// 2. Then detect browser language
	const browserLanguage = navigator.language.substring(0, 2);
	if (this.config.supportedLanguages.includes(browserLanguage)) {
	  return browserLanguage;
	}

	// 3. Finally use default language
	return this.config.defaultLanguage;
  }

  /**
   * Gets the i18next instance (UMD or ES6)
   */
  private async getI18next(): Promise<any> {
	if (this.i18next) return this.i18next;

	// Detect if we're in a module environment or UMD
	if (typeof window !== 'undefined' && window.i18next) {
	  // UMD environment (script tag)
	  this.i18next = window.i18next;
	  return this.i18next;
	} else {
	  // ES6 modules environment
	  try {
		const i18nextModule = await import('i18next');
		this.i18next = i18nextModule.default;
		return this.i18next;
	  } catch (error) {
		console.error('Failed to import i18next:', error);
		throw error;
	  }
	}
  }

  /**
   * Initializes i18next with the configuration
   */
  async init(): Promise<void> {
	if (this.initialized) return;

	try {
	  const i18next = await this.getI18next();
	  
	  // Detect initial language
	  const initialLanguage = this.detectInitialLanguage();
	  
	  // Load translation resources
	  const resources: any = {};
	  
	  for (const lang of this.config.supportedLanguages) {
		try {
		  const response = await fetch(`${this.config.resourcesPath}/${lang}.json`);
		  if (response.ok) {
			resources[lang] = {
			  translation: await response.json()
			};
		  }
		} catch (error) {
		  console.warn(`Failed to load translations for ${lang}:`, error);
		}
	  }

	  await i18next.init({
		lng: initialLanguage,
		fallbackLng: this.config.defaultLanguage,
		resources,
		interpolation: {
		  escapeValue: false, // Call sites use textContent or explicitly escape interpolated values.
		  // `{{amount, money}}` renders the value with the active board's currency symbol, so the
		  // app strings stay generic and the board supplies the symbol (no per-board overrides).
		  format: (value: unknown, format?: string) => format === 'money' ? this.formatMoney(value) : String(value),
		}
	  });

	  this.currentLanguage = initialLanguage;
	  this.initialized = true;
	  
	  console.debug(`i18next initialized successfully with language: ${initialLanguage}`);
	} catch (error) {
	  console.error('Failed to initialize i18next:', error);
	  throw error;
	}
  }

  /**
   * Merges an uploaded package's own translations over the app's, so a package game can use its
   * own i18n keys (group names, square/card text…). Fetches /api/packages/{token}/i18n/{lang} for
   * each supported language and adds it to the 'translation' namespace; package keys win on
   * conflict. Safe to call once the game's package token is known.
   */
  async loadPackageResources(token: string): Promise<void> {
	const i18next = await this.getI18next();
	for (const lang of this.config.supportedLanguages) {
	  try {
		const response = await fetch(`/api/packages/${encodeURIComponent(token)}/i18n/${encodeURIComponent(lang)}`);
		if (!response.ok) continue; // package ships no file for this language
		const json = sanitizePackageTranslations(await response.json());
		i18next.addResourceBundle(lang, 'translation', json, true /* deep merge */, true /* overwrite */);
	  } catch (error) {
		console.debug('[i18n] package resources load failed for', lang, error);
	  }
	}
  }

  /**
   * Applies translations to all elements with data-i18n in the DOM
   */
  async applyI18n(container: Element | Document = document): Promise<void> {
	if (!this.initialized) {
	  console.warn('i18next not initialized. Call init() first.');
	  return;
	}

	const i18next = await this.getI18next();

	// Update the HTML lang attribute
	document.documentElement.lang = this.currentLanguage;

	// Find elements with data-i18n for text content
	const textElements = container.querySelectorAll('[data-i18n]');
	textElements.forEach(element => {
	  const key = element.getAttribute('data-i18n');
	  if (key) {
		const translation = i18next.t(key, this.defaultVars);
		if (translation !== key) { // Only apply if translation was found
		  if (element.tagName === 'TITLE') {
			// For the title, also update document.title
			element.textContent = translation;
			document.title = translation;
		  } else {
			element.textContent = translation;
		  }
		}
	  }
	});

	// Find elements with data-i18n-attr:* for attributes
	const attrElements = container.querySelectorAll('*');
	let attrCount = 0;
	attrElements.forEach(element => {
	  const attributes = element.attributes;
	  for (let i = 0; i < attributes.length; i++) {
		const attr = attributes[i];
		if (attr.name.startsWith('data-i18n-attr:')) {
		  const targetAttr = attr.name.replace('data-i18n-attr:', '');
		  const key = attr.value;

		  const translation = i18next.t(key, this.defaultVars);
		  if (translation !== key) { // Only apply if translation was found
			element.setAttribute(targetAttr, translation);
			attrCount++;
		  }
		}
	  }
	});

	// Some first-paint copy has an English HTML fallback but must not enter the visual or
	// accessibility tree before the player's locale is known. Reveal these elements only after
	// this complete translation pass; if a resource is unavailable, their readable fallback is
	// still revealed instead of leaving the interface permanently blank.
	container.querySelectorAll<HTMLElement>('[data-i18n-defer]').forEach(element => {
	  element.hidden = false;
	  element.removeAttribute('data-i18n-defer');
	});

	console.debug(`Applied translations for language: ${this.currentLanguage} (${textElements.length} text elements, ${attrCount} attributes)`);
  }

  /**
   * Changes the language and reapplies translations
   */
  async changeLanguage(language: string, container: Element | Document = document): Promise<void> {
	if (!this.initialized) {
	  console.warn('i18next not initialized. Call init() first.');
	  return;
	}

	if (!this.config.supportedLanguages.includes(language)) {
	  console.warn(`Language ${language} is not supported`);
	  return;
	}

	try {
	  const i18next = await this.getI18next();
	  const previousLanguage = this.currentLanguage;
	  
	  await i18next.changeLanguage(language);
	  this.currentLanguage = language;
	  
	  // Save to cookie
	  this.saveLanguageToCookie(language);
	  
	  await this.applyI18n(container);
	  
	  // Dispatch custom event to notify the change. It MUST bubble: the lobby subscribes on
	  // `window`, and a non-bubbling event dispatched on `document` never reaches a `window`
	  // listener (window is an ancestor of document in the propagation path). Without this the
	  // whole onLanguageChanged refresh — token/board selectors, saved games — silently never
	  // ran, so anything set imperatively via t() kept its old-language text until a reload.
	  const event = new CustomEvent('languageChanged', {
		bubbles: true,
		detail: { language, previousLanguage }
	  });
	  document.dispatchEvent(event);
	  
	  console.debug(`Language changed to: ${language} (saved to cookie)`);
	} catch (error) {
	  console.error(`Failed to change language to ${language}:`, error);
	}
  }

  /**
   * Gets a translation directly (for use in JavaScript)
   */
  async t(key: string, options?: any): Promise<string> {
	if (!this.initialized) {
	  console.warn('i18next not initialized. Call init() first.');
	  return key;
	}
	const i18next = await this.getI18next();
	const result = i18next.t(key, { ...this.defaultVars, ...options });
	return typeof result === 'string' ? result : key;
  }

  /**
   * Synchronous version of t() - requires i18next to be initialized
   * Uses window.i18next directly if available
   */
  tSync(key: string, options?: any): string {
	const i18next = window.i18next;
	if (!i18next?.t) {
	  console.warn('i18next not available for sync translation');
	  return key;
	}
	// Merge the board vocabulary so every string can reference {{currency}}/{{holding}}/… ; explicit
	// options win on conflict.
	const result = i18next.t(key, { ...this.defaultVars, ...options });
	return typeof result === 'string' ? result : key;
  }

  /**
   * Localizes color names (synchronous version)
   */
  localizeColor(raw?: string): string {
	if (!raw) return '';
	const clean = String(raw).toLowerCase().replace(/[^a-z]/g, '');
	const key = `game.color_${clean}`;
	const translated = this.tSync(key);
	if (translated !== key) return translated;
	return String(raw).replace(/[-_]/g, ' ');
  }

  /**
   * Gets the current language
   */
  getCurrentLanguage(): string {
	return this.currentLanguage;
  }

  /**
   * Gets the supported languages
   */
  getSupportedLanguages(): string[] {
	return this.config.supportedLanguages;
  }

  /**
   * Observes DOM changes and automatically applies translations to new elements
   */
  async observeDOM(): Promise<void> {
	if (!this.initialized) {
	  console.warn('i18next not initialized. Call init() first.');
	  return;
	}

	const observer = new MutationObserver((mutations) => {
	  mutations.forEach((mutation) => {
		if (mutation.type === 'childList') {
		  mutation.addedNodes.forEach((node) => {
			if (node.nodeType === Node.ELEMENT_NODE) {
			  this.applyI18n(node as Element);
			}
		  });
		}
	  });
	});

	observer.observe(document.body, {
	  childList: true,
	  subtree: true
	});

	console.debug('DOM observer started for automatic translations');
  }
}

// Shared global instance.
export const i18nBinder = new I18nBinder();

// Async convenience functions for global use.
export const t = async (key: string, options?: any) => await i18nBinder.t(key, options);
export const applyI18n = async (container?: Element | Document) => await i18nBinder.applyI18n(container);
export const changeLanguage = async (language: string, container?: Element | Document) => 
  await i18nBinder.changeLanguage(language, container);

// Synchronous functions for use in code that cannot be async
export const tSync = (key: string, options?: any) => i18nBinder.tSync(key, options);
export const localizeColor = (raw?: string) => i18nBinder.localizeColor(raw);
/** Formats an amount with the active board's currency symbol (for TS-built strings). */
export const money = (value: number | string) => i18nBinder.money(value);

/**
 * Translates a server error code to a human-readable message using i18n.
 * If the code is UPPERCASE_WITH_UNDERSCORES, looks up serverErrors.{CODE}.
 * If not a recognized code, returns the original message (legacy).
 */
export const translateServerError = async (errorCode: string): Promise<string> => {
  // If it's a known error code (UPPERCASE_WITH_UNDERSCORES), translate it
  if (/^[A-Z_]+$/.test(errorCode)) {
	const translated = await i18nBinder.t(`serverErrors.${errorCode}`);
	// If translation was found, use it; otherwise return the code
	return translated !== `serverErrors.${errorCode}` ? translated : errorCode;
  }
  // If not a code, return the message as-is (for legacy errors)
  return errorCode;
};

/**
 * Synchronous version of translateServerError for cases where async cannot be used.
 * Uses window.i18next directly if available.
 */
export const translateServerErrorSync = (errorCode: string): string => {
  // If it's a known error code (UPPERCASE_WITH_UNDERSCORES), translate it
  if (/^[A-Z_]+$/.test(errorCode)) {
	const i18next = window.i18next;
	if (i18next?.t) {
	  const key = `serverErrors.${errorCode}`;
	  const translated = i18next.t(key);
	  return translated !== key ? translated : errorCode;
	}
	return errorCode;
  }
  // If not a code, return the message as-is
  return errorCode;
};
