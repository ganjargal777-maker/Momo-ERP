import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startDockerPostgres15, LOCAL_PG_IMAGE_TAG } from '../scripts/local-social-docker.mjs';
const CID='a'.repeat(64),NID='b'.repeat(64),IID='sha256:'+'c'.repeat(64);
function fake({version='postgres (PostgreSQL) 15.20',port='127.0.0.1:49155',gateway='172.19.0.1',notReady=1}={}) {
  const state={calls:[],runId:null,foreign:false,created:false,removed:false,networkRemoved:false,readyCalls:0,fixturePassword:null,fixtureGateway:null};
  state.runner=(bin,all,options)=>{
    assert.equal(all[0],'--host');assert.equal(all[1],'npipe:////./pipe/dockerDesktopLinuxEngine');
    assert.equal(options.windowsHide,true);
    const a=all.slice(2);state.calls.push(a);
    const output=(stdout='',status=0)=>({stdout,status,stderr:''});
    if(a[0]==='image'){assert.equal(a.at(-1),LOCAL_PG_IMAGE_TAG);return output(IID);}
    if(a[0]==='network'&&a[1]==='create'){state.runId=a[a.indexOf('--label')+1].split('=')[1];return output(NID);}
    if(a[0]==='run'){state.created=true;state.fixturePassword=options.env.MOMO_LOCAL_DB_PASSWORD;state.fixtureGateway=options.env.MOMO_LOCAL_DB_GATEWAY_CIDR;return output(CID);}
    if(a[0]==='port')return output(port);
    if(a[0]==='exec'){
      const at=a.indexOf(CID);assert.ok(at>0);
      const utility=a[at+1];
      if(utility==='postgres')return output(version);
      if(utility==='pg_isready')return ++state.readyCalls<=notReady?output('',1):output('accepting connections');
      return output('fixture-tool-ok');
    }
    if(a[0]==='container'&&a[1]==='inspect')return !state.created||state.removed?output('',1):output(CID+'|'+(state.foreign?'foreign-run':state.runId));
    if(a[0]==='container'&&a[1]==='ls')return output('');
    if(a[0]==='container'&&a[1]==='rm'){assert.equal(a.at(-1),CID);state.removed=true;return output(CID);}
    if(a[0]==='network'&&a[1]==='inspect')return output(a.includes('{{(index .IPAM.Config 0).Gateway}}')?gateway:state.runId);
    if(a[0]==='network'&&a[1]==='rm'){assert.equal(a.at(-1),NID);state.networkRemoved=true;return output(NID);}
    throw new Error('Unexpected fake Docker command');
  };
  return state;
}
const options=state=>({dockerBin:resolve('fake-docker.exe'),runner:state.runner,sleep:async()=>{},readinessAttempts:3});

test('rejects remote/default Docker targets before any command',async()=>{
  let called=false;
  for(const host of ['tcp://127.0.0.1:2375','ssh://remote','tcp://remote:2375','']) {
    await assert.rejects(()=>startDockerPostgres15({dockerBin:resolve('fake-docker.exe'),dockerHost:host,runner:()=>{called=true;}}),/Only the local/);
  }
  assert.equal(called,false);
});
test('fresh owned PG15 lifecycle pins cached image, loopback, tmpfs and label-verified cleanup',async()=>{
  const state=fake(),pg=await startDockerPostgres15(options(state));
  assert.equal(pg.port,49155);assert.equal(pg.imageId,IID);assert.equal(pg.user,'momo_local');
  assert.equal(pg.version,'postgres (PostgreSQL) 15.20');
  const run=state.calls.find(a=>a[0]==='run'),network=state.calls.find(a=>a[0]==='network'&&a[1]==='create');
  assert.equal(network[network.indexOf('--driver')+1],'bridge');assert.ok(!network.includes('--internal'));assert.ok(run.includes('--pull=never'));assert.ok(run.includes('--read-only'));
  assert.equal(run[run.indexOf('--publish')+1],'127.0.0.1::5432');assert.equal(run[run.indexOf('--user')+1],'postgres');
  assert.ok(run.includes('/tmp:rw,nosuid,nodev,mode=1777'));assert.ok(!run.includes('--volume'));assert.ok(!run.includes('--mount'));
  assert.ok(!run.join(' ').includes(state.fixturePassword));
  assert.ok(run.at(-1).includes('--auth-host=scram-sha-256 --auth-local=trust'));
  assert.ok(run.at(-1).includes('unix_socket_directories=/tmp'));
  assert.equal(pg.gateway,'172.19.0.1');assert.equal(state.fixtureGateway,'172.19.0.1/32');
  assert.ok(run.at(-1).includes('host all momo_local %s scram-sha-256'));
  assert.ok(!run.at(-1).includes('0.0.0.0/0'));assert.ok(run.includes('MOMO_LOCAL_DB_GATEWAY_CIDR'));
  assert.equal(pg.execInContainer(['pg_dump','-h','/tmp','-U','momo_local','-Fc','-f','/tmp/prealignment.dump','postgres']),'fixture-tool-ok');
  assert.throws(()=>pg.execInContainer(['pg_dump','postgres']),/Backup output/);
  assert.throws(()=>pg.execInContainer(['psql','--host','remote.example','postgres']),/Only local/);
  assert.throws(()=>pg.execInContainer(['psql','--dbname=host=remote.example dbname=postgres']),/connection strings/);
  assert.throws(()=>pg.execInContainer(['sh','-c','echo bad']),/Invalid local/);
  await pg.stop();await pg.stop();assert.equal(state.removed,true);assert.equal(state.networkRemoved,true);
  assert.equal(state.calls.filter(a=>a[0]==='container'&&a[1]==='rm').length,1);
});
test('wrong server major fails and cleans up only its own resources',async()=>{
  const state=fake({version:'postgres (PostgreSQL) 17.12'});
  await assert.rejects(()=>startDockerPostgres15(options(state)),/PostgreSQL 15/);
  assert.equal(state.removed,true);assert.equal(state.networkRemoved,true);
});
test('non-loopback published port fails and cleans up',async()=>{
  const state=fake({port:'0.0.0.0:49155'});
  await assert.rejects(()=>startDockerPostgres15(options(state)),/only on IPv4 loopback/);
  assert.equal(state.removed,true);assert.equal(state.networkRemoved,true);
});
test('changed ownership refuses utility calls and destructive cleanup',async()=>{
  const state=fake(),pg=await startDockerPostgres15(options(state));state.foreign=true;
  assert.throws(()=>pg.execInContainer(['createdb','-h','/tmp','-U','momo_local','restored_fixture']),/ownership/);
  await assert.rejects(()=>pg.stop(),/ownership/);
  assert.equal(state.removed,false);assert.equal(state.networkRemoved,false);
});
test('readiness deadline cleans up the fresh test container',async()=>{
  const state=fake({notReady:99});
  await assert.rejects(()=>startDockerPostgres15(options(state)),/did not become ready/);
  assert.equal(state.readyCalls,3);assert.equal(state.removed,true);assert.equal(state.networkRemoved,true);
});
test('invalid bridge gateway fails before startup and cleans up only its network',async()=>{
  const state=fake({gateway:'172.19.0.1/0'});
  await assert.rejects(()=>startDockerPostgres15(options(state)),/valid IPv4 gateway/);
  assert.equal(state.created,false);assert.equal(state.removed,false);assert.equal(state.networkRemoved,true);
});

