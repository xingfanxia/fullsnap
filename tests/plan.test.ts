import { describe, expect, it } from 'vitest';
import { fileStem, finalSize, MAX_CANVAS_SIDE, nextOffset, placeTile, sliceForCanvas } from '../src/core/plan';
import type { PageInfo } from '../src/core/types';

const offsets = (regionHeight: number, contentHeight: number) => {
	const result = [0];
	for (let next = nextOffset(0, regionHeight, contentHeight); next !== null; next = nextOffset(next, regionHeight, contentHeight)) {
		result.push(next);
	}
	return result;
};

describe('nextOffset', () => {
	it('steps by one region and clamps the last step to the bottom', () => {
		expect(offsets(800, 2000)).toEqual([0, 800, 1200]);
		expect(offsets(800, 2400)).toEqual([0, 800, 1600]);
	});

	it('needs a single shot when everything already fits', () => {
		expect(offsets(800, 800)).toEqual([0]);
		expect(offsets(800, 500)).toEqual([0]);
	});
});

describe('placeTile', () => {
	const info: PageInfo = {
		title: '',
		url: '',
		viewport: { width: 1000, height: 800 },
		region: { x: 200, y: 60, width: 800, height: 740 },
		contentHeight: 3000,
		background: '#fff',
	};

	it('keeps the whole viewport for the first shot and only the scrolling region afterwards', () => {
		expect(placeTile(info, 0, 0)).toEqual({ source: { x: 0, y: 0, width: 1000, height: 800 }, dest: { x: 0, y: 0 } });
		expect(placeTile(info, 2, 1480)).toEqual({ source: info.region, dest: { x: 200, y: 1540 } });
	});

	it('sizes the image to hold the region content below its top edge', () => {
		expect(finalSize(info, 3000)).toEqual({ width: 1000, height: 3060 });
		expect(finalSize({ ...info, region: { x: 0, y: 0, width: 1000, height: 800 } }, 500)).toEqual({ width: 1000, height: 800 });
	});
});

describe('sliceForCanvas', () => {
	it('keeps an ordinary image whole', () => {
		expect(sliceForCanvas(2880, 20_000)).toEqual([[0, 20_000]]);
	});

	it('splits images taller than a canvas can be', () => {
		const slices = sliceForCanvas(2880, 70_000);
		expect(slices).toEqual([[0, MAX_CANVAS_SIDE], [MAX_CANVAS_SIDE, MAX_CANVAS_SIDE], [2 * MAX_CANVAS_SIDE, 70_000 - 2 * MAX_CANVAS_SIDE]]);
	});

	it('respects the area limit for very wide images', () => {
		const [first] = sliceForCanvas(20_000, 30_000);
		expect(first![1] * 20_000).toBeLessThanOrEqual(268_435_456);
	});
});

describe('fileStem', () => {
	it('cleans the title and appends a sortable timestamp', () => {
		expect(fileStem('Docs: a/b?  ', new Date(2026, 9, 13, 8, 5))).toBe('Docs a b 2026-10-13 08.05');
		expect(fileStem('', new Date(2026, 0, 2, 3, 4))).toBe('page 2026-01-02 03.04');
	});
});
