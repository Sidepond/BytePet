import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const binary=path.join(root,'src-tauri/target/debug/bytepet-tauri');
function execute(args,{env={},input,timeout=45000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd:root,env:{...process.env,...env},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Tauri test timed out'));},timeout);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(input);
  });
}
test('Tauri: shared UI runs through real WKWebView and native IPC',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'bytepet-tauri-test-'));
  try {
    const report=path.join(directory,'report.json');const claude=path.join(directory,'claude');await mkdir(claude);
    const result=await execute([`--user-data-dir=${path.join(directory,'profile')}`,`--smoke-script=${path.join(root,'tests/tauri-smoke.js')}`,`--smoke-report=${report}`],{env:{CLAUDE_CONFIG_DIR:claude}});
    const value=JSON.parse(await readFile(report,'utf8'));assert.equal(value.ok,true,JSON.stringify(value));assert.equal(result.code,0,result.stderr);assert.ok(value.checks.length>=37);
    const foods=await import('node:fs/promises').then(fs=>fs.readdir(path.join(directory,'profile/food')));
    assert.equal(foods.filter(id=>!id.startsWith('.')).length,3);
    for(const id of foods.filter(id=>!id.startsWith('.'))) {
      const base=path.join(directory,'profile/food',id);const meta=JSON.parse(await readFile(path.join(base,'meta.json'),'utf8'));
      if(meta.filename==='바이너리.bin') assert.deepEqual(await readFile(path.join(base,'content',meta.filename)),Buffer.from([0,255,10,128]));
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('Tauri: standalone Claude bridge preserves status line output and stores only normalized limits',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'bytepet-tauri-claude-'));
  try {
    const config=path.join(directory,'config.json'),snapshot=path.join(directory,'usage.json');
    await writeFile(config,JSON.stringify({snapshotPath:snapshot,previousStatusLine:{type:'command',command:'printf "existing status"'}}));
    const result=await execute(['--claude-statusline',config],{input:JSON.stringify({rate_limits:{five_hour:{used_percentage:25,resets_at:1800000000}},api_key:'never store this',transcript_path:'/private/transcript'})});
    assert.equal(result.code,0);assert.equal(result.stdout,'existing status');
    const text=await readFile(snapshot,'utf8');const saved=JSON.parse(text);assert.equal(saved.windows[0].usedPercent,25);assert.equal(saved.windows[0].resetsAt,1800000000000);assert.doesNotMatch(text,/private|api_key|transcript/);
    const oversized=await execute(['--claude-statusline',config],{input:'x'.repeat(1024*1024+1)});assert.equal(oversized.code,1);assert.equal(await readFile(snapshot,'utf8'),text);
  } finally {await rm(directory,{recursive:true,force:true});}
});
