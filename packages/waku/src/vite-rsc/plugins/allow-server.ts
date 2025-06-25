import type { Plugin } from 'vite';
import * as swc from '@swc/core';
import {
  createEmptySpan,
  createIdentifier,
} from '../../lib/plugins/vite-plugin-rsc-transform.js';

export function wakuAllowServerPlugin(): Plugin {
  return {
    name: 'waku:allow-server',
    transform(code) {
      if (this.environment.name !== 'rsc') return;
      if (!code.includes('use client')) return;

      const mod = swc.parseSync(code);
      if (!hasDirective(mod, 'use client')) return;

      const result = transformAllowServerDCE(mod);
      let newCode = swc.printSync(mod).code;
      for (const name of result.exportNames) {
        newCode += `export ${name === 'default' ? name : `const ${name} =`} __waku_no_keep__;\n`;
      }
      return `"use client";` + newCode;
    },
  };
}

function hasDirective(mod: swc.Module, directive: string): boolean {
  for (const item of mod.body) {
    if (item.type === 'ExpressionStatement') {
      if (
        item.expression.type === 'StringLiteral' &&
        item.expression.value === directive
      ) {
        return true;
      }
    }
  }
  return false;
}

/*
Apply dead code elimination to preserve only `allowServer` exports.


=== Example input ===

"use client"
import { unstable_allowServer as allowServer } from 'waku/client';
import { atom } from 'jotai/vanilla';
import clientDep from "./client-dep" // 🗑️

const local1 = 1;
export const countAtom = allowServer(atom(local1));

const local2 = 2; // 🗑️
export const MyClientComp = () => <div>hey: {local2} {clientDep}</div> // 🗑️

=== Example output ===

"use client"
import { atom } from 'jotai/vanilla';

const local1 = 1;
export const countAtom = atom(local1);

export const MyClientComp = __waku_no_keep__

*/

function transformAllowServerDCE(mod: swc.Module) {
  // TODO: reuse `transformExportedClientThings`
  // in packages/waku/src/lib/plugins/vite-plugin-rsc-transform.ts

  const exportNames = new Set<string>();
  // HACK this doesn't cover all cases
  const allowServerItems = new Map<string, swc.Expression>();
  const allowServerDependencies = new Set<string>();
  const visited = new WeakSet<swc.Node>();
  const findDependencies = (node: swc.Node) => {
    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    if (node.type === 'Identifier') {
      const id = node as swc.Identifier;
      if (!allowServerItems.has(id.value) && !exportNames.has(id.value)) {
        allowServerDependencies.add(id.value);
      }
    }
    Object.values(node).forEach((value) => {
      (Array.isArray(value) ? value : [value]).forEach((v) => {
        if (typeof v?.type === 'string') {
          findDependencies(v);
        } else if (typeof v?.expression?.type === 'string') {
          findDependencies(v.expression);
        }
      });
    });
  };
  // Pass 1: find allowServer identifier
  let allowServer = 'unstable_allowServer';
  let hasAllowServer = false;
  for (const item of mod.body) {
    if (item.type === 'ImportDeclaration') {
      if (item.source.value === 'waku/client') {
        for (const specifier of item.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            if (specifier.imported?.value === allowServer) {
              allowServer = specifier.local.value;
              hasAllowServer = true;
              break;
            }
          }
        }
        break;
      }
    }
  }

  // Pass 2: collect export names and allowServer names
  for (const item of mod.body) {
    if (item.type === 'ExportDeclaration') {
      if (item.declaration.type === 'FunctionDeclaration') {
        exportNames.add(item.declaration.identifier.value);
      } else if (item.declaration.type === 'ClassDeclaration') {
        exportNames.add(item.declaration.identifier.value);
      } else if (item.declaration.type === 'VariableDeclaration') {
        for (const d of item.declaration.declarations) {
          if (d.id.type === 'Identifier') {
            if (
              d.init?.type === 'CallExpression' &&
              d.init.callee.type === 'Identifier' &&
              d.init.callee.value === allowServer
            ) {
              if (d.init.arguments.length !== 1) {
                throw new Error('allowServer should have exactly one argument');
              }
              allowServerItems.set(d.id.value, d.init.arguments[0]!.expression);
              findDependencies(d.init);
            } else {
              exportNames.add(d.id.value);
            }
          }
        }
      }
    } else if (item.type === 'ExportNamedDeclaration') {
      for (const s of item.specifiers) {
        if (s.type === 'ExportSpecifier') {
          exportNames.add(s.exported ? s.exported.value : s.orig.value);
        }
      }
    } else if (item.type === 'ExportDefaultExpression') {
      exportNames.add('default');
    } else if (item.type === 'ExportDefaultDeclaration') {
      exportNames.add('default');
    }
  }
  // Pass 3: collect dependencies
  let dependenciesSize: number;
  do {
    dependenciesSize = allowServerDependencies.size;
    for (const item of mod.body) {
      if (item.type === 'VariableDeclaration') {
        for (const d of item.declarations) {
          if (
            d.id.type === 'Identifier' &&
            allowServerDependencies.has(d.id.value)
          ) {
            findDependencies(d);
          }
        }
      } else if (item.type === 'FunctionDeclaration') {
        if (allowServerDependencies.has(item.identifier.value)) {
          findDependencies(item);
        }
      } else if (item.type === 'ClassDeclaration') {
        if (allowServerDependencies.has(item.identifier.value)) {
          findDependencies(item);
        }
      }
    }
  } while (dependenciesSize < allowServerDependencies.size);
  allowServerDependencies.delete(allowServer);

  // Pass 4: filter with dependencies
  for (let i = 0; i < mod.body.length; ++i) {
    const item = mod.body[i]!;
    if (
      item.type === 'ImportDeclaration' &&
      item.specifiers.some(
        (s) =>
          s.type === 'ImportSpecifier' &&
          allowServerDependencies.has(
            s.imported ? s.imported.value : s.local.value,
          ),
      )
    ) {
      continue;
    }
    if (item.type === 'VariableDeclaration') {
      item.declarations = item.declarations.filter(
        (d) =>
          d.id.type === 'Identifier' && allowServerDependencies.has(d.id.value),
      );
      if (item.declarations.length) {
        continue;
      }
    }
    if (item.type === 'FunctionDeclaration') {
      if (allowServerDependencies.has(item.identifier.value)) {
        continue;
      }
    }
    if (item.type === 'ClassDeclaration') {
      if (allowServerDependencies.has(item.identifier.value)) {
        continue;
      }
    }
    mod.body.splice(i--, 1);
  }
  // Pass 5: add allowServer exports
  for (const [allowServerName, callExp] of allowServerItems) {
    const stmt: swc.ExportDeclaration = {
      type: 'ExportDeclaration',
      declaration: {
        type: 'VariableDeclaration',
        kind: 'const',
        declare: false,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        ctxt: 0,
        declarations: [
          {
            type: 'VariableDeclarator',
            id: createIdentifier(allowServerName),
            init: callExp,
            definite: false,
            span: createEmptySpan(),
          },
        ],
        span: createEmptySpan(),
      },
      span: createEmptySpan(),
    };
    mod.body.push(stmt);
  }

  return { hasAllowServer: true, exportNames };
}
