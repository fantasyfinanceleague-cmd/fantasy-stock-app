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

  // Paint first, hydrate after. The entry is a module script, so it never
  // blocks HTML parsing, but if it arrives before the first frame (warm
  // cache, fast network) its execution still delays that frame. The page is
  // fully readable without it, so request it from a tiny loader after the
  // first paint instead: the prerendered text paints on its own, then React
  // hydrates. One entry script is expected; anything else fails the build.
  const ENTRY = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/g;
  const entries = [...shell.matchAll(ENTRY)];
  if (entries.length !== 1) fail(`expected exactly one entry module script, found ${entries.length}`);
  const entrySrc = entries[0][1];
  const loader =
    '<script>requestAnimationFrame(function () { setTimeout(function () {' +
    ' var s = document.createElement("script"); s.type = "module"; s.crossOrigin = "";' +
    ` s.src = ${JSON.stringify(entrySrc)}; document.body.appendChild(s); }, 0); });</script>`;

  const markup = ssr.render();
  if (!markup || markup.length < 1000) fail(`render() returned ${markup ? markup.length : 0} chars`);

  const head = ssr.landingHead;
  const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const VIEWPORT = /<meta name="viewport"[^>]*>/;
  if (!VIEWPORT.test(shell)) fail('no viewport meta in dist/index.html');
  const html = shell
    .replace(VIEWPORT, (m) => `${m}\n    ${head.preload}`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(head.title)}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${escapeAttr(head.description)}" />`
    )
    .replace('</head>', `    ${head.tags.join('\n    ')}\n  </head>`)
    .replace(ENTRY, '')
    .replace(ROOT, `<div id="root">${markup}</div>`)
    .replace('</body>', `  ${loader}\n  </body>`);
  if (!html.includes(loader) || html.includes(`src="${entrySrc}"></script>`)) fail('entry script rewrite failed');

  await writeFile(distIndex, html);
  console.log(`prerender-landing: wrote ${markup.length} chars of landing markup into dist/index.html`);
}

// The SSR bundle is a build intermediate only; never deploy it.
await rm(ssrDir, { recursive: true, force: true });
