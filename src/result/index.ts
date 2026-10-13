import { PDFDocument } from 'pdf-lib';
import { fileStem, sliceForCanvas } from '../core/plan';
import type { Capture } from '../core/types';
import { loadCapture } from '../shared/store';

const t = (key: string, ...substitutions: string[]) => chrome.i18n.getMessage(key, substitutions);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const note = byId<HTMLParagraphElement>('note');
const sheet = byId<HTMLElement>('sheet');

/** PDF pages may be at most 14400 points tall; at 0.75 points per CSS pixel that is 19200 CSS pixels. */
const MAX_PDF_PAGE_CSS_PX = 19_200;
const POINTS_PER_CSS_PX = 0.75;

/** Draws the capture onto as few canvases as the browser's size limits allow and returns them top to bottom. */
const stitch = async (capture: Capture) => {
	const bitmaps = await Promise.all(capture.tiles.map(tile => createImageBitmap(tile.image)));
	// Screenshots are taken at device resolution, so the ratio also carries the page zoom and display density.
	const scale = bitmaps[0]!.width / capture.viewportWidth;
	const width = Math.round(capture.width * scale);
	const height = Math.round(capture.height * scale);

	const canvases = sliceForCanvas(width, height).map(([top, sliceHeight]) => {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = sliceHeight;
		const context = canvas.getContext('2d')!;
		context.fillStyle = capture.background;
		context.fillRect(0, 0, width, sliceHeight);

		capture.tiles.forEach((tile, index) => {
			const { source, dest } = tile;
			context.drawImage(
				bitmaps[index]!,
				Math.round(source.x * scale), Math.round(source.y * scale),
				Math.round(source.width * scale), Math.round(source.height * scale),
				Math.round(dest.x * scale), Math.round(dest.y * scale) - top,
				Math.round(source.width * scale), Math.round(source.height * scale),
			);
		});
		return canvas;
	});

	for (const bitmap of bitmaps) {
		bitmap.close();
	}
	return { canvases, scale, width, height };
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
	canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))), type, quality);
});

const save = (blob: Blob, name: string) => {
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
};

const buildPdf = async (canvases: HTMLCanvasElement[], scale: number) => {
	const pdf = await PDFDocument.create();
	const maxPagePx = Math.floor(MAX_PDF_PAGE_CSS_PX * scale);

	for (const canvas of canvases) {
		for (let top = 0; top < canvas.height; top += maxPagePx) {
			const pageHeight = Math.min(maxPagePx, canvas.height - top);
			const page = document.createElement('canvas');
			page.width = canvas.width;
			page.height = pageHeight;
			page.getContext('2d')!.drawImage(canvas, 0, -top);

			const image = await pdf.embedJpg(await (await toBlob(page, 'image/jpeg', 0.92)).arrayBuffer());
			const size: [number, number] = [canvas.width / scale * POINTS_PER_CSS_PX, pageHeight / scale * POINTS_PER_CSS_PX];
			pdf.addPage(size).drawImage(image, { x: 0, y: 0, width: size[0], height: size[1] });
		}
	}
	return new Blob([await pdf.save() as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
};

const main = async () => {
	for (const [id, key] of [['png', 'savePng'], ['jpg', 'saveJpg'], ['pdf', 'savePdf'], ['copy', 'copy']] as const) {
		byId(id).textContent = t(key);
	}

	const capture = await loadCapture(new URLSearchParams(location.search).get('id') ?? '');
	if (!capture) {
		note.textContent = t('missing');
		document.querySelector<HTMLElement>('.tools')!.hidden = true;
		return;
	}

	document.title = `${capture.title} · fullsnap`;
	byId('title').textContent = capture.title || capture.url;
	note.textContent = t('stitching');
	const { canvases, scale, width, height } = await stitch(capture);
	for (const canvas of canvases) {
		canvas.style.width = `${capture.width}px`;
	}
	sheet.replaceChildren(...canvases);
	byId('facts').textContent = t('facts', String(width), String(height), new URL(capture.url).host);
	note.textContent = canvases.length > 1 ? t('split', String(canvases.length)) : '';

	const stem = fileStem(capture.title, new Date(capture.createdAt));
	const numbered = (index: number, ext: string) => (
		canvases.length > 1 ? `${stem} (${index + 1} of ${canvases.length}).${ext}` : `${stem}.${ext}`
	);

	/** Runs an export with its button disabled, reporting the outcome in the status line. */
	const action = (id: string, doneKey: string, work: () => Promise<void>) => {
		const button = byId<HTMLButtonElement>(id);
		button.addEventListener('click', async () => {
			button.disabled = true;
			try {
				await work();
				note.textContent = t(doneKey);
			} catch (error) {
				note.textContent = t('failed', error instanceof Error ? error.message : String(error));
			} finally {
				button.disabled = false;
			}
		});
	};

	action('png', 'saved', async () => {
		for (const [index, canvas] of canvases.entries()) {
			save(await toBlob(canvas, 'image/png'), numbered(index, 'png'));
		}
	});
	action('jpg', 'saved', async () => {
		for (const [index, canvas] of canvases.entries()) {
			save(await toBlob(canvas, 'image/jpeg', 0.92), numbered(index, 'jpg'));
		}
	});
	action('pdf', 'saved', async () => save(await buildPdf(canvases, scale), `${stem}.pdf`));
	action('copy', 'copied', async () => {
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(canvases[0]!, 'image/png') })]);
	});
};

void main();
