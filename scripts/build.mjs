import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Unsupported artifact version');
const expectedHost = `./lib/host.${version}.js`;
if (!fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').includes(`name: ${expectedHost}\n`))
  throw new Error(`Update the bundle insertion to name: ${expectedHost} when changing version`);
const lib = path.join(root, 'lib');
fs.mkdirSync(lib, { recursive: true });
const write = (name, content) => {
  const target = path.resolve(lib, name);
  if (path.dirname(target) !== lib) throw new Error('Generated artifact escaped lib');
  fs.writeFileSync(target, content);
};
const source = fs.readFileSync(path.join(root, 'source/client.cjs'), 'utf8');
const bundle = `// Built with scripts/build.mjs; uses the DSH platform React singleton.\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {\nconst module = {exports:{}}; const exports = module.exports;\n${source}\nreturn module.exports;\n}});\n`;
write('client.js', bundle);
// Immutable entry/dependency URLs avoid reusing a prior release's evaluated Host modules.
for (const module of ['host', 'monitor', 'debug']) {
  let code = fs.readFileSync(path.join(root, `${module}.js`), 'utf8');
  for (const dependency of ['monitor', 'debug'])
    code = code.replaceAll(`'./${dependency}.js'`, `'./${dependency}.${version}.js'`);
  write(`${module}.${version}.js`, code);
}
console.log(`Built lib/client.js (${Buffer.byteLength(bundle)} bytes) and versioned Host ${version}`);
