// Bundles the extension into dist/: three entry points (service worker, injected page script, result page) plus the static files.
import { cp, rm } from 'node:fs/promises';
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
	entryPoints: {
		background: 'src/background/index.ts',
		page: 'src/page/index.ts',
		result: 'src/result/index.ts',
	},
	outdir: 'dist',
	bundle: true,
	format: 'esm',
	target: 'chrome121',
	sourcemap: watch ? 'inline' : false,
	logLevel: 'info',
};

await rm('dist', { recursive: true, force: true });
await cp('static', 'dist', { recursive: true, filter: source => !source.endsWith('.svg') });

if (watch) {
	await (await context(options)).watch();
} else {
	await build(options);
}
