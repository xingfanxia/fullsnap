/** A rectangle in CSS pixels. */
export type Rect = { x: number; y: number; width: number; height: number };

/** What the page reports before capturing starts. */
export type PageInfo = {
	title: string;
	url: string;
	viewport: { width: number; height: number };
	/**
	 * The part of the viewport that scrolls: the whole viewport when the document itself scrolls, or the box of the
	 * inner element that does.
	 */
	region: Rect;
	/** Scrollable height of the content inside `region`. */
	contentHeight: number;
	background: string;
};

/** One screenshot of the viewport and where its useful part belongs in the final image. */
export type Tile = {
	image: Blob;
	/** Part of the screenshot to keep, in CSS pixels relative to the viewport. */
	source: Rect;
	/** Where that part goes in the final image, in CSS pixels. */
	dest: { x: number; y: number };
};

export type Capture = {
	id: string;
	title: string;
	url: string;
	createdAt: number;
	/** Size of the final image in CSS pixels. */
	width: number;
	height: number;
	viewportWidth: number;
	background: string;
	tiles: Tile[];
};
