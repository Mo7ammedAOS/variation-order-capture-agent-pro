import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * A server component may not read plain DATA out of a client module.
 *
 * On 2026-09-05 the application shell imported `NAV_LINKS` — an array — from
 * `nav.tsx`, which begins with `'use client'`. In a production build React
 * replaces that export with a client-reference proxy, because it needs a
 * serialisable handle to send to the browser and a plain array is not a
 * component it knows how to proxy. So the shell called `.map` on an object
 * that does not have one, and EVERY page in the application answered 500.
 *
 * The reason it deserves a test rather than a note: nothing else catches it.
 * `tsc` is happy, ESLint is happy, `next build` is happy, and `next dev` runs
 * it correctly, because in development the module is loaded directly. It fails
 * only in a production build — which is to say only in front of the people who
 * use it.
 *
 * The rule this enforces: a `'use client'` file exports COMPONENTS. Anything a
 * server file also needs to read lives in its own module with no directive at
 * the top, imported by both sides. Types are exempt — they are erased before
 * any of this matters.
 */

const APP = resolve(__dirname, '../../src/app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

function isClientModule(file: string): boolean {
  // The directive must be the first statement, so only the head matters.
  return /^\s*(['"])use client\1/.test(readFileSync(file, 'utf8'));
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    base = resolve(__dirname, '../../src', specifier.slice(2));
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** `import { A, type B, C as D } from '…'` → the named bindings, types dropped. */
function namedImports(clause: string): string[] {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces?.[1]) return [];
  return braces[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('type '))
    .map((part) => part.split(/\s+as\s+/)[0]?.trim() ?? '');
}

/**
 * PascalCase, and nothing else. `SidebarNav` is a component; `NAV_LINKS` and
 * `ICONS` are data wearing capital letters.
 */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name) && !name.includes('_');
}

describe('the server/client boundary', () => {
  it('never lets a server file read a non-component export from a client module', () => {
    const offences: string[] = [];

    for (const file of walk(APP)) {
      if (isClientModule(file)) continue;

      const source = readFileSync(file, 'utf8');
      const pattern = /import\s+((?:type\s+)?[^;'"]*?)\s+from\s+['"]([^'"]+)['"]/g;

      for (const match of source.matchAll(pattern)) {
        const [, clause = '', specifier = ''] = match;
        if (clause.trim().startsWith('type ')) continue;

        const target = resolveImport(file, specifier);
        if (!target || !isClientModule(target)) continue;

        for (const name of namedImports(clause)) {
          // A component. React can proxy it, and that is what the boundary is
          // for. Anything else is data, and data does not survive the crossing.
          //
          // PascalCase, strictly: a leading capital AND a lowercase letter
          // somewhere. "Just starts with a capital" is what let the original
          // bug through when this test was first written — `NAV_LINKS` passed
          // it. SCREAMING_SNAKE_CASE is a constant, and a constant is data.
          if (isComponentName(name)) continue;
          offences.push(
            `${file.replace(`${APP}/`, '')} imports "${name}" from the client module ` +
              `${target.replace(`${APP}/`, '')} — move it to a module without 'use client'.`,
          );
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
