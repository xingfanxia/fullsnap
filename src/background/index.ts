import { finalSize, MAX_TILES, nextOffset, placeTile } from '../core/plan';
import type { Capture, Tile } from '../core/types';
import type { GotoReply, PageCommand, PageReply } from '../shared/messages';
import { saveCapture } from '../shared/store';

/** Chrome allows two `captureVisibleTab` calls per second; this keeps a margin below that. */
const CAPTURE_INTERVAL_MS = 550;

const capturing = new Set<number>();

const ask = <C extends PageCommand>(tabId: number, command: C) => (
	chrome.tabs.sendMessage(tabId, command) as Promise<PageReply<C>>
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const setBadge = (tabId: number, text: string) => chrome.action.setBadgeText({ tabId, text }).catch(() => {});

const capturePage = async (tab: chrome.tabs.Tab) => {
	const tabId = tab.id!;
	await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'] });

	const info = await ask(tabId, { fullsnap: 'begin' });
	const tiles: Tile[] = [];
	let contentHeight = info.contentHeight;
	let lastShot = 0;

	try {
		let target: number | null = 0;
		while (target !== null && tiles.length < MAX_TILES) {
			const reply: GotoReply = await ask(tabId, { fullsnap: 'goto', offset: target, first: tiles.length === 0 });
			contentHeight = Math.max(contentHeight, reply.contentHeight);

			await sleep(Math.max(0, lastShot + CAPTURE_INTERVAL_MS - Date.now()));
			const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
			lastShot = Date.now();
			tiles.push({ image: await (await fetch(dataUrl)).blob(), ...placeTile(info, tiles.length, reply.offset) });

			const done = Math.min(1, (reply.offset + info.region.height) / contentHeight);
			await setBadge(tabId, `${Math.round(done * 100)}%`);

			// A page that did not move as far as asked has reached its real end, whatever height it reported.
			target = reply.offset < target - 1 ? null : nextOffset(reply.offset, info.region.height, contentHeight);
		}
	} finally {
		await ask(tabId, { fullsnap: 'end' }).catch(() => {});
	}

	const capture: Capture = {
		id: crypto.randomUUID(),
		title: info.title,
		url: info.url,
		createdAt: Date.now(),
		...finalSize(info, contentHeight),
		viewportWidth: info.viewport.width,
		background: info.background,
		tiles,
	};
	await saveCapture(capture);
	await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?id=${capture.id}`), index: tab.index + 1 });
};

chrome.action.onClicked.addListener(tab => {
	if (!tab.id || capturing.has(tab.id)) {
		return;
	}
	const tabId = tab.id;
	capturing.add(tabId);
	void chrome.action.setBadgeBackgroundColor({ color: '#1f6f5c' });

	capturePage(tab)
		.then(() => setBadge(tabId, ''))
		.catch(async error => {
			console.error('fullsnap:', error);
			await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
			await setBadge(tabId, '!');
			await chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage('cannotCapture') });
		})
		.finally(() => capturing.delete(tabId));
});
