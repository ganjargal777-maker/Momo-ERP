import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { STAGING_ORIGIN, validateStagingOrigin, parseHostedBrowserArgs, hostedBrowserFetch, runHostedErpBrowser } from '../scripts/check-hosted-erp-browser.mjs';

test('hosted browser runner is inert without explicit synthetic-write opt-in', async () => {
  let calls=0;
  const result=await runHostedErpBrowser({keysFile:'missing',clientFactory:()=>{calls++;throw Error();},fetchImpl:()=>{calls++;throw Error();}});
  assert.equal(result.status,'SKIPPED');assert.equal(calls,0);assert.equal(result.productionWrites,0);
});
test('hosted browser identity cannot be changed to production or an arbitrary host',()=>{
  assert.equal(validateStagingOrigin(STAGING_ORIGIN),STAGING_ORIGIN);
  for(const address of ['https://erp.momoshop.mn','https://other.onrender.com',STAGING_ORIGIN+'/?next=elsewhere','http://momo-erp-social-sandbox.onrender.com',STAGING_ORIGIN+'/elsewhere'])assert.throws(()=>validateStagingOrigin(address));
});
test('hosted browser CLI rejects unsafe overrides and requires absolute local paths',()=>{
  assert.equal(parseHostedBrowserArgs([]).execute,false);
  const dir=resolve(tmpdir());assert.equal(parseHostedBrowserArgs(['--execute-sandbox-write','--staging-url',STAGING_ORIGIN,'--keys-file',join(dir,'keys.json')]).execute,true);
  for(const args of [['--target','https://erp.momoshop.mn'],['--keys-file','relative.json'],['--execute-sandbox-write','--execute-sandbox-write'],['--staging-url','https://erp.momoshop.mn']])assert.throws(()=>parseHostedBrowserArgs(args));
});
test('hosted browser fetch rejects production, redirects and writes to the static host',async()=>{
  const calls=[];const guarded=hostedBrowserFetch(async(input,options)=>{calls.push({input,options});return new Response('{}');});
  await guarded(STAGING_ORIGIN+'/runtime-config.js',{redirect:'follow'});assert.equal(calls[0].options.redirect,'error');
  await guarded('https://mmvmvweitrhlgqtjadaz.supabase.co/rest/v1/organizations',{method:'POST'});
  for(const [url,method] of [[STAGING_ORIGIN,'POST'],['https://lxjkkqypiwnnrjmnpick.supabase.co/rest/v1/organizations','DELETE'],['https://graph.facebook.com/v27.0/me/messages','POST'],['https://attacker.example.invalid/','GET']])await assert.rejects(guarded(url,{method}));
  assert.equal(calls.length,2);
});
test('a production-bound privileged key is rejected before SDK or network construction',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'momo-browser-guard-'));
  t.after(()=>{assert.equal(dirname(dir),resolve(tmpdir()));assert.ok(basename(dir).startsWith('momo-browser-guard-'));rmSync(dir,{recursive:true,force:true});});
  const jwt=(ref,role)=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({ref,role})).toString('base64url')+'.synthetic_not_a_signature';
  const file=join(dir,'keys.json');writeFileSync(file,JSON.stringify([{name:'service_role',api_key:jwt('lxjkkqypiwnnrjmnpick','service_role')},{name:'anon',api_key:jwt('mmvmvweitrhlgqtjadaz','anon')}]));
  let calls=0;await assert.rejects(runHostedErpBrowser({execute:true,keysFile:file,chromiumPath:join(dir,'browser.exe'),reportPath:join(dir,'report.json'),stagingOrigin:STAGING_ORIGIN,clientFactory:()=>{calls++;},fetchImpl:()=>{calls++;}}),e=>e.code==='key_project_or_role_mismatch');assert.equal(calls,0);
});
