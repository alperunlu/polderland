/**
 * Guards the two dictionaries against the four ways a translation goes wrong
 * silently: a key that exists in one language and not the other, a placeholder
 * that was dropped in translation, a character the pixel font cannot draw, and
 * a placeholder the code never fills in.
 *
 * The last one matters most here. The font is hand-authored, so an accented
 * letter nobody added simply renders as a blank box on a player's screen — and
 * only on the screen that string appears on, which is easy to miss by hand.
 */

import { LANGS, keysOf, setLang, t } from '../src/systems/i18n.js';
import { GLYPHS } from '../src/art/font.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const problems = [];

const sets = Object.fromEntries(LANGS.map((l) => [l, new Set(keysOf(l))]));
const base = LANGS[0];
for (const lang of LANGS.slice(1)) {
  for (const key of sets[base]) {
    if (!sets[lang].has(key)) problems.push(`${lang}: missing key ${key}`);
  }
  for (const key of sets[lang]) {
    if (!sets[base].has(key)) problems.push(`${lang}: key ${key} is not in ${base}`);
  }
}

const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

for (const key of sets[base]) {
  setLang(base);
  const reference = t(key);
  for (const lang of LANGS) {
    setLang(lang);
    const value = t(key);
    if (typeof value === 'string' && value.trim() === '') {
      problems.push(`${lang}: ${key} is empty`);
    }
    if (typeof reference === 'string' && typeof value === 'string'
      && placeholders(reference) !== placeholders(value)) {
      problems.push(`${lang}: ${key} has placeholders ${placeholders(value)}, `
        + `${base} has ${placeholders(reference)}`);
    }
    if (typeof value === 'string') {
      // Placeholders are substituted before anything is drawn, so the braces
      // themselves never reach the font.
      for (const ch of value.replace(/\{\w+\}/g, '')) {
        if (ch !== '\n' && GLYPHS[ch] === undefined) {
          problems.push(`${lang}: ${key} uses "${ch}" (U+${ch.codePointAt(0)
            .toString(16).toUpperCase().padStart(4, '0')}), which the font has no glyph for`);
        }
      }
    }
  }
}

/*
 * Call sites. A string can be translated perfectly and still reach the screen
 * as "wind from the {dir}" if the code that shows it never passes `dir`: the
 * dictionary checks above cannot see that, and the font cannot draw braces, so
 * the player just sees a sentence with its most important word missing. Every
 * call with a literal key is read here and its arguments held against the
 * placeholders the string actually has.
 */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

/** Top-level property names of the object literal starting at `src[open]`. */
function objectKeys(src, open) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let entry = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('({['.includes(ch)) { depth++; if (depth === 1) continue; }
    if (')}]'.includes(ch)) { depth--; if (depth === 0) { keys.push(entry); break; } }
    if (depth === 1 && ch === ',') { keys.push(entry); entry = ''; continue; }
    if (depth === 1) entry += ch;
  }
  return keys.map((e) => (e.match(/^\s*(\w+)\s*(?::|$)/) || [])[1]).filter(Boolean);
}

setLang(base);
for (const file of sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\btr?\(\s*'([\w.]+)'\s*([,)])/g)) {
    const key = m[1];
    if (!sets[base].has(key)) continue;
    const wanted = new Set((String(t(key)).match(/\{\w+\}/g) || []).map((p) => p.slice(1, -1)));
    let given = [];
    if (m[2] === ',') {
      const open = src.indexOf('{', m.index + m[0].length);
      const between = src.slice(m.index + m[0].length, open);
      if (open < 0 || between.trim() !== '') continue; // not an object literal
      given = objectKeys(src, open);
    }
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${file.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/')}:${line}`;
    for (const p of wanted) {
      if (!given.includes(p)) problems.push(`${where}: ${key} needs {${p}} but it is not passed`);
    }
  }
}

if (problems.length) {
  console.error('Translation problems:');
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`i18n ok: ${LANGS.length} languages, ${sets[base].size} keys each`);
