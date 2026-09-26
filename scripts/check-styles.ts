import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Fails when a component uses a CSS Module class its stylesheet lacks, or a var(--token) that tokens.css does not define. */
const root = path.resolve(import.meta.dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

const classCache = new Map<string, Set<string>>();
function classesOf(cssFile: string): Set<string> {
  let set = classCache.get(cssFile);
  if (!set) {
    const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    set = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!));
    classCache.set(cssFile, set);
  }
  return set;
}

const problems: string[] = [];
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)) {
    const [, local, spec] = m as unknown as [string, string, string];
    const cssFile = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(file), spec);
    const defined = classesOf(cssFile);
    const used = new Set([...src.matchAll(new RegExp(`\\b${local}\\.([A-Za-z_]\\w*)`, 'g'))].map((u) => u[1]!));
    for (const name of used) {
      if (!defined.has(name)) problems.push(`${path.relative(root, file)}: ${local}.${name} is not defined in ${path.relative(root, cssFile)}`);
    }
  }
}

const tokens = new Set([...readFileSync(path.join(root, 'styles', 'tokens.css'), 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
const styleFiles = [...walk(root), ...walkCss(root)];
for (const file of styleFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/var\((--[\w-]+)\s*([,)])/g)) {
    if (m[2] === ',' || tokens.has(m[1]!)) continue;
    problems.push(`${path.relative(root, file)}: ${m[1]} is not a design token`);
  }
}

function walkCss(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walkCss(full) : name.endsWith('.css') ? [full] : [];
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('CSS module references OK');
