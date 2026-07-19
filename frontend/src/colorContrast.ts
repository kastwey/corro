/**
 * Pick whichever of black or white has the stronger WCAG contrast against an
 * opaque hexadecimal background. One of those two always reaches at least 4.58:1.
 * Invalid/package-supplied values fall back to white; callers should pair that
 * with a known neutral background fallback.
 */
export function contrastingTextColor(background: string): '#000000' | '#ffffff' {
	const rgb = parseHexColor(background);
	if (!rgb) return '#ffffff';
	const luminance = relativeLuminance(rgb);
	const blackContrast = (luminance + 0.05) / 0.05;
	const whiteContrast = 1.05 / (luminance + 0.05);
	return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

function parseHexColor(value: string): [number, number, number] | null {
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	if (short) {
		return short.slice(1).map(channel => Number.parseInt(channel + channel, 16)) as [number, number, number];
	}
	const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
	if (!full) return null;
	return full.slice(1).map(channel => Number.parseInt(channel, 16)) as [number, number, number];
}

function relativeLuminance(rgb: [number, number, number]): number {
	const [red, green, blue] = rgb.map(channel => {
		const value = channel / 255;
		return value <= 0.04045
			? value / 12.92
			: Math.pow((value + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
