// @vitest-environment node
//
// What the pages' CSP (vercel.json: style-src 'self', font-src 'self', no
// third-party origin) means for the code that ships: no inline style attribute
// (it would be blocked), no outside stylesheet or font, and the self-hosted
// font files and their licence exist.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dir = resolve(root, 'src/join');
const sources = readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(resolve(dir, f), 'utf-8');

describe('the join pages obey their own CSP', () => {
  it('sees the source files', () => {
    expect(sources).toContain('JoinFlow.tsx');
    expect(sources).toContain('joinWeb.css');
  });

  it('no inline style attribute (style-src \'self\' would block it)', () => {
    for (const f of sources.filter((x) => x.endsWith('.tsx'))) {
      expect({ file: f, inline: /\bstyle\s*=\s*[{"']/.test(read(f)) }).toEqual({ file: f, inline: false });
    }
  });

  it('no outside origin anywhere: no web-font service, no @import, no http(s) URL but our own copy', () => {
    for (const f of sources) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');
      expect({ file: f, fonts: /fonts\.(googleapis|gstatic)/.test(text) }).toEqual({ file: f, fonts: false });
      expect({ file: f, imp: /@import/.test(text) }).toEqual({ file: f, imp: false });
    }
  });

  it('no file here holds an invisible or bidi-control character as a LITERAL (they must be \\u escapes: unreviewable in a diff, and a "trojan source" hazard)', () => {
    // Cc/Cf and the blank fillers; ordinary punctuation and emoji are fine.
    const invisible = /[\p{Cc}\p{Cf}\u034F\u115F\u1160\u2800\u3164\uFFA0\u00A0]/u;
    const all = readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f));
    for (const f of all) {
      const offending = [...read(f)].filter((c) => invisible.test(c) && c !== '\n' && c !== '\t' && c !== '\r').map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase());
      expect({ file: f, offending }).toEqual({ file: f, offending: [] });
    }
  });

  it('every @font-face is a self-hosted TTF that exists, with the licence next to it', () => {
    const css = read('joinWeb.css');
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls).toHaveLength(4);
    for (const u of urls) {
      expect(u).toMatch(/^\/fonts\/archivo\/Archivo-[A-Za-z]+\.ttf$/);
      expect(existsSync(resolve(root, 'public', u.slice(1)))).toBe(true);
    }
    expect(existsSync(resolve(root, 'public/fonts/archivo/OFL.txt'))).toBe(true);
  });

  it('the font files are the app\'s (byte for byte)', () => {
    for (const n of ['Regular', 'SemiBold', 'Bold', 'ExtraBold']) {
      const web = readFileSync(resolve(root, `public/fonts/archivo/Archivo-${n}.ttf`));
      const app = readFileSync(resolve(root, `../mobile/assets/fonts/archivo/Archivo-${n}.ttf`));
      expect(web.equals(app)).toBe(true);
    }
  });
});
