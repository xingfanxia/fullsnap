import type { PageInfo, Rect } from '../core/types';
import type { GotoReply, PageCommand } from '../shared/messages';

// Injected into the page being captured. It only moves the page around and reports geometry; taking the screenshots
// happens in the service worker.

type State = {
	target: Element;
	/** True when the document itself scrolls rather than an inner element. */
	isDocument: boolean;
	originalScroll: { top: number; left: number };
	style: HTMLStyleElement;
	hidden: Set<HTMLElement>;
	focused: Element | null;
};

const HIDE_ATTRIBUTE = 'data-fullsnap-hidden';
const TARGET_ATTRIBUTE = 'data-fullsnap-target';

declare global {
	interface Window {
		fullsnapInstalled?: boolean;
	}
}

let state: State | null = null;

const scrollsVertically = (element: Element) => {
	if (element.scrollHeight - element.clientHeight < 2) {
		return false;
	}
	if (element === document.scrollingElement) {
		return true;
	}
	const overflow = getComputedStyle(element).overflowY;
	return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
};

/**
 * Finds what scrolls. Usually that is the document; app-like pages instead keep the document fixed and scroll one
 * large inner element, in which case the scrollable element covering the most viewport area is used.
 */
const findScrollTarget = (): Element => {
	const root = document.scrollingElement ?? document.documentElement;
	if (scrollsVertically(root)) {
		return root;
	}

	const viewportArea = innerWidth * innerHeight;
	let best: Element | null = null;
	let bestArea = viewportArea * 0.3;
	for (const element of document.querySelectorAll('*')) {
		if (element.scrollHeight - element.clientHeight < 2 || !scrollsVertically(element)) {
			continue;
		}
		const rect = visibleRect(element);
		const area = rect.width * rect.height;
		if (area > bestArea) {
			best = element;
			bestArea = area;
		}
	}
	return best ?? root;
};

/** The part of an element's box that is inside the viewport, excluding its own scrollbar. */
const visibleRect = (element: Element): Rect => {
	const box = element.getBoundingClientRect();
	const left = Math.max(0, box.left + element.clientLeft);
	const top = Math.max(0, box.top + element.clientTop);
	const right = Math.min(innerWidth, box.left + element.clientLeft + element.clientWidth);
	const bottom = Math.min(innerHeight, box.top + element.clientTop + element.clientHeight);
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};

const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits until what is on screen has been laid out and painted, and its images have loaded, within a time limit. */
const settle = async () => {
	await frames();
	const pending = [...document.images].filter(image => {
		if (image.complete) {
			return false;
		}
		const box = image.getBoundingClientRect();
		return box.bottom > 0 && box.top < innerHeight && box.width > 0;
	});
	await Promise.race([
		Promise.all(pending.map(image => image.decode().catch(() => {}))),
		pause(1500),
	]);
	await pause(100);
	await frames();
};

/**
 * Scrolls through the content once before anything is measured, so content that only loads when it comes into view
 * is present and the height has stopped changing by the time screenshots are taken.
 */
const warmUp = async (target: Element) => {
	const step = Math.max(200, target.clientHeight);
	for (let passes = 0; passes < 80 && target.scrollTop + target.clientHeight < target.scrollHeight - 1; passes++) {
		target.scrollTop += step;
		await pause(40);
	}
	target.scrollTop = 0;
};

/**
 * Hides elements that stay put while the page scrolls, so a fixed header or a stuck sticky bar is not repeated in
 * every screenshot after the first.
 */
const hidePinnedElements = (current: State) => {
	const scope = current.isDocument ? document : current.target;
	for (const element of scope.querySelectorAll<HTMLElement>('*')) {
		if (current.hidden.has(element)) {
			continue;
		}
		const style = getComputedStyle(element);
		const pinned = style.position === 'fixed'
			|| (style.position === 'sticky' && isStuck(element, style, current));
		if (pinned && style.visibility !== 'hidden' && style.display !== 'none') {
			element.setAttribute(HIDE_ATTRIBUTE, '');
			current.hidden.add(element);
		}
	}
};

/** A sticky element is stuck when it sits at its `top` (or `bottom`) offset inside the scrolling box. */
const isStuck = (element: HTMLElement, style: CSSStyleDeclaration, current: State) => {
	const box = element.getBoundingClientRect();
	const region = current.isDocument
		? { top: 0, bottom: innerHeight }
		: (() => {
			const rect = visibleRect(current.target);
			return { top: rect.y, bottom: rect.y + rect.height };
		})();
	const top = Number.parseFloat(style.top);
	const bottom = Number.parseFloat(style.bottom);
	return (Number.isFinite(top) && Math.abs(box.top - region.top - top) < 1.5)
		|| (Number.isFinite(bottom) && Math.abs(region.bottom - box.bottom - bottom) < 1.5);
};

const begin = async (): Promise<PageInfo> => {
	if (state) {
		end();
	}

	const target = findScrollTarget();
	const isDocument = target === (document.scrollingElement ?? document.documentElement);
	target.setAttribute(TARGET_ATTRIBUTE, '');

	const style = document.createElement('style');
	style.textContent = `
		html, body, [${TARGET_ATTRIBUTE}] { scroll-behavior: auto !important; scrollbar-width: none !important; }
		html::-webkit-scrollbar, body::-webkit-scrollbar, [${TARGET_ATTRIBUTE}]::-webkit-scrollbar { display: none !important; }
		[${HIDE_ATTRIBUTE}] { visibility: hidden !important; }
		* { caret-color: transparent !important; }
	`;
	document.documentElement.append(style);

	state = {
		target,
		isDocument,
		originalScroll: { top: target.scrollTop, left: target.scrollLeft },
		style,
		hidden: new Set(),
		focused: document.activeElement,
	};
	target.scrollLeft = 0;
	await warmUp(target);
	await settle();

	const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
	const background = [document.body, document.documentElement]
		.map(element => (element ? getComputedStyle(element).backgroundColor : ''))
		.find(color => color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') ?? '#ffffff';

	return {
		title: document.title,
		url: location.href,
		viewport,
		region: isDocument ? { x: 0, y: 0, ...viewport } : visibleRect(target),
		contentHeight: target.scrollHeight,
		background,
	};
};

const goto = async (offset: number, first: boolean): Promise<GotoReply> => {
	if (!state) {
		throw new Error('capture has not begun');
	}
	state.target.scrollTop = offset;
	await settle();
	if (!first) {
		hidePinnedElements(state);
		await frames();
	}
	return { offset: state.target.scrollTop, contentHeight: state.target.scrollHeight };
};

const end = () => {
	if (!state) {
		return;
	}
	for (const element of state.hidden) {
		element.removeAttribute(HIDE_ATTRIBUTE);
	}
	state.target.removeAttribute(TARGET_ATTRIBUTE);
	state.target.scrollTop = state.originalScroll.top;
	state.target.scrollLeft = state.originalScroll.left;
	state.style.remove();
	state = null;
};

if (!window.fullsnapInstalled) {
	window.fullsnapInstalled = true;
	chrome.runtime.onMessage.addListener((message: PageCommand, _sender, respond) => {
		if (message?.fullsnap === 'begin') {
			void begin().then(respond);
			return true;
		}
		if (message?.fullsnap === 'goto') {
			void goto(message.offset, message.first).then(respond);
			return true;
		}
		if (message?.fullsnap === 'end') {
			end();
			respond(true);
		}
		return false;
	});
}
