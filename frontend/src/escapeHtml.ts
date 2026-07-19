/**
 * Escapes text that is interpolated into an innerHTML string. Board and card content can come from
 * an uploaded .corro package, so it must never be trusted as markup.
 */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, c =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
