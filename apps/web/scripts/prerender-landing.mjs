// scripts/prerender-landing.mjs — build-time prerender of the paused landing.
//
// Runs as the last step of `npm run build` (after `vite build` and
// `vite build --ssr src/entry-server.jsx --outDir dist-ssr`). While
// APP_PAUSED is true it renders `/` to static HTML and writes it into
// dist/index.html, so the landing's headings and paragraphs are readable
// with JavaScript off and the first paint doesn't wait on the JS bundle
// (docs/design/prompts/phase3a-landing.md: "Never gate content", LCP ≤ 2.0s).
// main.jsx then hydrates that markup in place.
//
// While APP_PAUSED is false it does nothing: dist/index.html stays the empty
// SPA shell, byte-for-byte what `vite build` wrote.
//
// Fails the build (exit 1) rather than shipping a half-written page if the
// shell's markers are missing or the render comes back empty.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const distIndex = `${webRoot}dist/index.html`;
const ssrDir = `${webRoot}dist-ssr/`;

function fail(message) {
  console.error(`prerender-landing: ${message}`);
  process.exit(1);
}

const ssr = await import(pathToFileURL(`${ssrDir}entry-server.js`).href);

if (!ssr.APP_PAUSED) {
  console.log('prerender-landing: APP_PAUSED is false — dist/index.html left as the SPA shell.');
} else {
  const shell = await readFile(distIndex, 'utf-8');
  const ROOT = '<div id="root"></div>';
  if (shell.split(ROOT).length !== 2) fail(`expected exactly one ${ROOT} in dist/index.html`);
  if (!/<title>[^<]*<\/title>/.test(shell)) fail('no <title> in dist/index.html');
  if (!/<meta\s+name="description"[\s\S]*?\/>/.test(shell)) fail('no meta description in dist/index.html');

  const markup = ssr.render();
  if (!markup || markup.length < 1000) fail(`render() returned ${markup ? markup.length : 0} chars`);

  const head = ssr.landingHead;
  const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(head.title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${escapeAttr(head.description)}" />`
    )
    .replace('</head>', `    ${head.tags.join('\n    ')}\n  </head>`)
    .replace(ROOT, `<div id="root">${markup}</div>`);

  await writeFile(distIndex, html);
  console.log(`prerender-landing: wrote ${markup.length} chars of landing markup into dist/index.html`);
}

// The SSR bundle is a build intermediate only; never deploy it.
await rm(ssrDir, { recursive: true, force: true });
