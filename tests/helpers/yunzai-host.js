import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Isolated minimal host: tests exercise the actual single-file plugin without
// requiring a running QQ bot or installing its messaging dependencies.
export async function loadYunzaiPlugin() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'true-ranking-test-'));
  await fs.mkdir(path.join(root,'plugins/example'),{recursive:true});
  await fs.mkdir(path.join(root,'lib/plugins'),{recursive:true});
  await fs.mkdir(path.join(root,'lib/puppeteer'),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');
  await fs.writeFile(path.join(root,'lib/plugins/plugin.js'),'export default class Plugin { constructor(options) { Object.assign(this, options); } }');
  await fs.writeFile(path.join(root,'lib/puppeteer/puppeteer.js'),'export default { screenshot: async (name, data) => globalThis.__trueRankingScreenshot(name, data) };');
  const file = path.join(root,'plugins/example/true_ranking.js');
  const source = await fs.readFile(new URL('../../true_ranking.js',import.meta.url),'utf8');
  // Only the plugin class may be exported in production: Yunzai constructs all
  // exported functions as plugins. Expose helpers only in this isolated copy.
  await fs.writeFile(file,source+'\nexport {runtime,delay,RequestError,recoveryHint,newCheckpoint,validateCheckpoint,checkpointStore,progressText,CONFIG,parseCommand,parseTarget,loadCookie,createClient,collectReviews,analyze,summarize,filterRows,trend,probability,buildPanelHtml,buildTextResult,renderPanel};\n');
  const module = await import(pathToFileURL(file).href);
  return {module,root,source,cleanup:()=>{
    const resolved=path.resolve(root),temporary=path.resolve(os.tmpdir())+path.sep;
    if (!resolved.startsWith(temporary) || !path.basename(resolved).startsWith('true-ranking-test-')) throw new Error('Unexpected test directory');
    return fs.rm(resolved,{recursive:true,force:true});
  }};
}
