import type { PageInfo } from '../core/types';

/** Sent by the service worker to the script injected into the page being captured. */
export type PageCommand =
	/** Prepares the page (hides scrollbars, scrolls to the top) and reports its geometry. */
	| { fullsnap: 'begin' }
	/** Scrolls to `offset`; `first` keeps fixed and sticky elements visible, later steps hide them. */
	| { fullsnap: 'goto'; offset: number; first: boolean }
	/** Undoes everything `begin` and `goto` changed. */
	| { fullsnap: 'end' };

export type GotoReply = {
	/** Offset the page actually ended up at. */
	offset: number;
	/** Content height after scrolling, which grows on pages that load more as they are scrolled. */
	contentHeight: number;
};

export type PageReply<C extends PageCommand> =
	C extends { fullsnap: 'begin' } ? PageInfo :
		C extends { fullsnap: 'goto' } ? GotoReply : true;
