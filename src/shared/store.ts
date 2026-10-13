import type { Capture } from '../core/types';

const DB_NAME = 'fullsnap';
const STORE = 'captures';
/** Older captures beyond this many are dropped when a new one is saved. */
const KEEP = 20;

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
	const request = indexedDB.open(DB_NAME, 1);
	request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
});

const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = work(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
};

export const saveCapture = async (capture: Capture) => {
	await run('readwrite', store => store.put(capture));
	const all = await run<Capture[]>('readonly', store => store.getAll());
	const stale = all.sort((a, b) => b.createdAt - a.createdAt).slice(KEEP);
	for (const old of stale) {
		await run('readwrite', store => store.delete(old.id));
	}
};

export const loadCapture = (id: string) => run<Capture | undefined>('readonly', store => store.get(id));

export const deleteCapture = (id: string) => run('readwrite', store => store.delete(id));
