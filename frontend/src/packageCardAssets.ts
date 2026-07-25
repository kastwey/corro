// packageCardAssets.ts — resolve validated staged raster art without teaching renderers ids.

let packageToken: string | null = null;

/** Set from authoritative game state; PNG bytes never ride in card catalogs or documents. */
export function setCardArtPackageToken(token: string | null | undefined): void {
	packageToken = token || null;
}

/**
 * URL for a card whose server-validated catalog says PNG art exists. The card id is consumed
 * only as opaque package data here; visual renderers receive the finished URL and never branch
 * on package/card identity.
 */
export function packageCardPngUrl(source: { id?: string; hasPngArt?: boolean }): string | null {
	if (!source.hasPngArt || !source.id || !packageToken) return null;
	return `/api/packages/${encodeURIComponent(packageToken)}/cards/${encodeURIComponent(source.id)}.png`;
}
