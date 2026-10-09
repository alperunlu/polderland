/**
 * Fold the built game into one self-contained HTML file.
 *
 * The iOS app hosts the game in a WebView loaded from a string, which has no
 * file system to fetch a script from, so the bundle has to be inlined. Vite
 * emits exactly one chunk and keeps the styles inline in index.html, which
 * makes this a substitution rather than a bundler.
 */

import fs from 'fs';
import path from 'path';

const DIST = path.resolve('dist');
const OUT = path.resolve('dist-single/index.html');

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const scriptTag = /<script[^>]*src="([^"]+)"[^>]*><\/script>/g;
const matches = [...html.matchAll(scriptTag)];
if (matches.length !== 1) {
  throw new Error(`expected exactly one script tag in dist/index.html, found ${matches.length}`);
}

const [tag, src] = matches[0];
const jsPath = path.join(DIST, src.replace(/^\.?\//, ''));
const js = fs.readFileSync(jsPath, 'utf8');

// An inline script ends at the first `</script`, and `<!--` puts the HTML
// parser into a state where it can swallow one. Minified output has contained
// neither so far; fail the build rather than ship a page that silently lost
// half its code if that ever changes.
for (const seq of ['</script', '<!--']) {
  if (js.includes(seq)) {
    throw new Error(`bundle contains ${seq}, which would break the inline script`);
  }
}

// The replacement is given as a function: the bundle contains `$&` sequences,
// and a string replacement would expand those into the matched tag.
let out = html.replace(tag, () => `<script>\n${js}\n</script>`);

if (/<link[^>]+rel="stylesheet"/i.test(out)) {
  throw new Error('dist/index.html links an external stylesheet; inline it too');
}
if (/src="\.?\/?assets\//.test(out)) {
  throw new Error('output still references an external asset');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`single-file build -> ${OUT}`);
console.log(`  html ${kb(html.length)} + js ${kb(js.length)} = ${kb(out.length)}`);
