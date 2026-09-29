// Inlines the board's local files into ONE self-contained HTML file for
// publishing as an artifact (no relative fetches, no build step beyond this).
//   node docs/design/screens/build.mjs   →  docs/design/screens/key-screens.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), 'utf8');
const html = read('index.html').replace(/<!-- @inline (\S+) -->\n[^\n]*\n/g, (_, file) => {
  const src = read(file).replace(/<\/(script|style)/gi, '<\\/$1');
  if (file.endsWith('.css')) return `<style>\n${src}\n</style>\n`;
  if (file.endsWith('.jsx')) return `<script type="text/babel" data-presets="react">\n${src}\n</script>\n`;
  return `<script>\n${src}\n</script>\n`;
});
writeFileSync(join(dir, 'key-screens.html'), html);
console.log(`key-screens.html: ${(html.length / 1024).toFixed(1)} KB`);
