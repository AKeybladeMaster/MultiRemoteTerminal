import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { builtinModules } from 'node:module';

const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const root = resolve('.');
const failures = [];

async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const rel = relative(root, path).replaceAll('\\', '/');
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        let spec;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) spec = node.moduleSpecifier;
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) spec = node.arguments[0];
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) spec = node.argument.literal;
        if (spec) {
          if (!ts.isStringLiteralLike(spec)) failures.push(`${rel}: computed module import forbidden`);
          else {
            const name = spec.text;
            const dest = name.startsWith('.') ? relative(root, resolve(dirname(path), name)).replaceAll('\\', '/') : name;
            const domain = rel.startsWith('packages/domain/');
            const application = rel.startsWith('packages/application/');
            const contracts = rel.startsWith('packages/contracts/');
            const renderer = rel.includes('/src/renderer/');
            const inward = domain || application || contracts;
            // The framework-free domain may use this pure-JavaScript regex engine for bounded pattern policy.
            const domainPolicyLibrary = domain && name === 're2js';
            const relativeAllowed = domain ? dest.startsWith('packages/domain/') : application ? /^packages\/(domain|application)\//.test(dest) : contracts ? /^packages\/(domain|application|contracts)\//.test(dest) : !/packages\/adapters\//.test(dest) && !/apps\/desktop\/src\/(main|preload|workers)\//.test(dest);
            if ((inward && !name.startsWith('.') && !domainPolicyLibrary) || ((inward || renderer) && name.startsWith('.') && !relativeAllowed) || (renderer && (builtins.has(name) || name === 'electron' || (!name.startsWith('.') && !['react', 'react-dom/client', 'react/jsx-runtime', '@xterm/xterm', '@xterm/addon-fit', '@xterm/xterm/css/xterm.css'].includes(name))))) failures.push(`${rel}: forbidden dependency ${name}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
await scan('packages');
await scan('apps/desktop/src');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Import boundaries passed (static, dynamic, export, and type imports).');
