import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('HTML assets and app element references exist',()=>{
  const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),`Missing element ${match[1]}`);
  for(const match of html.matchAll(/(?:src|href)="\.\/([^"]*)"/g))if(match[1])assert.ok(fs.existsSync(new URL('../docs/'+match[1],import.meta.url)),`Missing asset ${match[1]}`);
});
