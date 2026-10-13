// End-to-end check: loads the built extension into Chromium, captures the test pages and compares pixels of the
// stitched result with the colours those pages are built from. Run via `npm run e2e`.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { serveFixtures } from '../../tests/serve';

const root = resolve(import.meta.dirname, '../..');
const shots = join(root, 'scratch/media/e2e');
const profile = mkdtempSync(join(tmpdir(), 'fullsnap-e2e-'));

// Clicking the toolbar button is what grants access to a tab, and that cannot be automated. The copy under test
// therefore gets host access up front; everything else is the extension exactly as built.
const extension = join(profile, 'extension');
cpSync(join(root, 'dist'), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
manifest.permissions.push('tabs');
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest));
mkdirSync(shots, { recursive: true });

const VIEWPORT = { width: 900, height: 700 };
const server = await serveFixtures(join(root, 'tests/pages'));
const context = await chromium.launchPersistentContext(join(profile, 'data'), {
	channel: 'chromium',
	headless: true,
	viewport: VIEWPORT,
	args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--force-device-scale-factor=2'],
});

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
	console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`);
	if (!condition) {
		failures.push(message);
	}
};

type Pixel = [number, number, number];
const near = (actual: Pixel, expected: Pixel) => actual.every((value, i) => Math.abs(value - expected[i]!) <= 3);

try {
	const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
	worker.on('console', message => console.error('worker:', message.text()));

	/** Captures `page` as a toolbar click would and returns the result page once stitching has finished. */
	const capture = async (page: Page): Promise<Page> => {
		await page.bringToFront();
		const opened = context.waitForEvent('page', { timeout: 60_000 });
		await worker.evaluate(async url => {
			const [tab] = await chrome.tabs.query({ url });
			(chrome.action.onClicked as unknown as { dispatch: (tab: chrome.tabs.Tab) => void }).dispatch(tab!);
		}, page.url());
		const result = await opened;
		result.on('pageerror', error => console.error('result error:', error.message));
		await result.getByTestId('sheet').locator('canvas').first().waitFor({ timeout: 30_000 });
		return result;
	};

	/** Reads a pixel of the stitched image at a position given in CSS pixels of the captured page. */
	const pixelAt = (result: Page, x: number, y: number) => result.evaluate(([px, py]) => {
		const canvas = document.querySelector('canvas')!;
		const scale = canvas.width / Number.parseFloat(canvas.style.width);
		const data = canvas.getContext('2d')!.getImageData(Math.round(px! * scale), Math.round(py! * scale), 1, 1).data;
		return [data[0], data[1], data[2]] as [number, number, number];
	}, [x, y]);

	const sizeOf = (result: Page) => result.evaluate(() => {
		const canvas = document.querySelector('canvas')!;
		return { width: canvas.width, height: canvas.height, count: document.querySelectorAll('canvas').length };
	});

	// A long document: seven 400px bands under a 60px sticky header, plus a fixed badge bottom right.
	{
		const page = await context.newPage();
		await page.goto(`${server.origin}/long.html`);
		await page.evaluate(() => scrollTo(0, 300));
		const result = await capture(page);
		const size = await sizeOf(result);
		check(size.width === 1800 && size.height === 2860 * 2 && size.count === 1, `long page: one ${size.width}x${size.height} image at 2x`);

		const bands: Pixel[] = [[10, 120, 10], [20, 20, 160], [160, 120, 20], [120, 20, 120], [20, 140, 140], [90, 90, 90], [230, 130, 30]];
		const bandsRight = await Promise.all(bands.map((_, i) => pixelAt(result, 450, 60 + i * 400 + 200)));
		check(bandsRight.every((pixel, i) => near(pixel, bands[i]!)), 'long page: every band is in its place');
		const tops = await Promise.all(bands.map((_, i) => pixelAt(result, 450, 60 + i * 400 + 5)));
		check(tops.every((pixel, i) => near(pixel, bands[i]!)), 'long page: band edges line up with no seams or offset');
		check(near(await pixelAt(result, 450, 30), [200, 0, 0]), 'long page: sticky header shown at the top');
		const headerRepeats = (await Promise.all([700, 1400, 2100, 2200, 2800].map(y => pixelAt(result, 450, y)))).filter(pixel => near(pixel, [200, 0, 0]));
		check(headerRepeats.length === 0, 'long page: sticky header not repeated further down');

		check(await page.evaluate(() => scrollY) === 300, 'long page: scroll position restored');
		check(await page.evaluate(() => document.querySelectorAll('[data-fullsnap-hidden], [data-fullsnap-target]').length) === 0, 'long page: nothing left changed in the page');
		await result.screenshot({ path: join(shots, 'result-light.png') });
		await result.emulateMedia({ colorScheme: 'dark' });
		await result.screenshot({ path: join(shots, 'result-dark.png') });

		const [png] = await Promise.all([result.waitForEvent('download'), result.getByTestId('save-png').click()]);
		check(/^Long page with a sticky header \d{4}-\d\d-\d\d \d\d\.\d\d\.png$/.test(png.suggestedFilename()), `long page: PNG saved as "${png.suggestedFilename()}"`);
		const [pdf] = await Promise.all([result.waitForEvent('download'), result.getByTestId('save-pdf').click()]);
		const pdfBytes = readFileSync(await pdf.path());
		check(pdfBytes.subarray(0, 5).toString() === '%PDF-' && pdfBytes.length > 10_000, `long page: PDF saved (${pdfBytes.length} bytes)`);
		await result.close();
		await page.close();
	}

	// An app layout: the document does not scroll; a pane right of a 160px sidebar and under a 50px bar does.
	{
		const page = await context.newPage();
		await page.goto(`${server.origin}/app.html`);
		const result = await capture(page);
		const size = await sizeOf(result);
		check(size.width === 1800 && size.height === 2050 * 2, `app page: inner pane unrolled into ${size.width}x${size.height}`);
		const bands: Pixel[] = [[10, 120, 10], [20, 20, 160], [160, 120, 20], [120, 20, 120]];
		const pixels = await Promise.all(bands.map((_, i) => pixelAt(result, 500, 50 + i * 500 + 250)));
		check(pixels.every((pixel, i) => near(pixel, bands[i]!)), 'app page: every band of the pane is in its place');
		check(near(await pixelAt(result, 80, 300), [40, 40, 40]) && near(await pixelAt(result, 450, 25), [200, 0, 0]), 'app page: sidebar and top bar kept from the first screen');
		await result.close();
		await page.close();
	}

	// A page that appends content when its bottom is reached must be captured at its grown height.
	{
		const page = await context.newPage();
		await page.goto(`${server.origin}/lazy.html`);
		const result = await capture(page);
		const size = await sizeOf(result);
		check(size.height === 2000 * 2, `lazy page: grown content included (${size.height}px tall)`);
		const bands: Pixel[] = [[10, 120, 10], [20, 20, 160], [160, 120, 20], [120, 20, 120]];
		const pixels = await Promise.all(bands.map((_, i) => pixelAt(result, 450, i * 500 + 250)));
		check(pixels.every((pixel, i) => near(pixel, bands[i]!)), 'lazy page: every band, including the late ones, is in its place');
		await result.close();
		await page.close();
	}

	// A page shorter than the window needs exactly one screenshot.
	{
		const page = await context.newPage();
		await page.goto(`${server.origin}/short.html`);
		const result = await capture(page);
		const size = await sizeOf(result);
		check(size.width === 1800 && size.height === 1400, `short page: single ${size.width}x${size.height} image`);
		check(near(await pixelAt(result, 450, 100), [10, 120, 10]) && near(await pixelAt(result, 450, 500), [250, 250, 250]), 'short page: content and background correct');
		await result.close();
		await page.close();
	}
} finally {
	await context.close();
	await server.close();
	rmSync(profile, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
