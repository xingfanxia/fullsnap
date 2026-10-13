import type { PageInfo, Rect } from './types';

/** Chrome refuses canvases beyond these; an image that would exceed them is split into several. */
export const MAX_CANVAS_SIDE = 32_767;
export const MAX_CANVAS_AREA = 268_435_456;

/** Upper bound on screenshots per capture, which also stops pages that keep growing as they are scrolled. */
export const MAX_TILES = 150;

/**
 * Picks the next scroll offset. Steps advance by one region height; the final step is clamped so the region ends
 * exactly at the bottom of the content. Returns null when the content is fully covered.
 */
export const nextOffset = (current: number, regionHeight: number, contentHeight: number): number | null => {
	const covered = current + regionHeight;
	if (covered >= contentHeight - 0.5) {
		return null;
	}
	return Math.min(covered, contentHeight - regionHeight);
};

/**
 * Where a tile taken at scroll offset `offset` lands. The first tile keeps the whole viewport, so anything around an
 * inner scrolling region (headers, sidebars) appears once; later tiles contribute only the scrolling region.
 */
export const placeTile = (info: PageInfo, index: number, offset: number): { source: Rect; dest: { x: number; y: number } } => {
	if (index === 0) {
		return {
			source: { x: 0, y: 0, width: info.viewport.width, height: info.viewport.height },
			dest: { x: 0, y: 0 },
		};
	}
	return { source: info.region, dest: { x: info.region.x, y: info.region.y + offset } };
};

/** Size of the stitched image in CSS pixels. */
export const finalSize = (info: PageInfo, contentHeight: number) => ({
	width: info.viewport.width,
	height: Math.max(info.viewport.height, info.region.y + contentHeight),
});

/**
 * Splits an image of the given pixel size into vertical slices that each fit in one canvas. Returns the slices as
 * `[top, height]` pairs in pixels.
 */
export const sliceForCanvas = (widthPx: number, heightPx: number): [number, number][] => {
	const maxHeight = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.floor(MAX_CANVAS_AREA / widthPx)));
	const slices: [number, number][] = [];
	for (let top = 0; top < heightPx; top += maxHeight) {
		slices.push([top, Math.min(maxHeight, heightPx - top)]);
	}
	return slices;
};

/** Builds a file name stem from a page title and a timestamp. */
export const fileStem = (title: string, when: Date): string => {
	const cleaned = title
		.normalize('NFC')
		.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s.]+|[\s.]+$/g, '');
	const stem = [...cleaned].slice(0, 80).join('').trim() || 'page';
	const pad = (value: number) => String(value).padStart(2, '0');
	const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
	return `${stem} ${date} ${pad(when.getHours())}.${pad(when.getMinutes())}`;
};
