import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const loaderStart=source.indexOf('let userManagementLoadRevision=0;');
const loaderEnd=source.indexOf('async function toggleSupabaseUser(',loaderStart);
assert.ok(loaderStart>=0&&loaderEnd>loaderStart,'test exercises the actual application loader');
const loaderCode=source.slice(loaderStart,loaderEnd);
const submitStart=source.indexOf('let userInvitePending=false;userForm.onsubmit=');
const submitEnd=source.indexOf("document.querySelector('#permission-select-all')",submitStart);
assert.ok(submitStart>=0&&submitEnd>submitStart,'test exercises the actual invite form submit');
const submitCode=source.slice(submitStart,submitEnd);
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const fixtureResult=name=>({profiles:{data:[{id:'employee',email:'synthetic@example.invalid',first_name:name,status:'active'}]},roles:{data:[{id:'role',name:'Synthetic role',description:'Synthetic',role_permissions:[]}]},user_roles:{data:[{user_id:'employee',role_id:'role',roles:{name:'Synthetic role'}}]}});
function loaderFixture(){
  const plans=[],toasts=[],renders=[];let requests=0;
  const client={from(table){const plan=plans[Math.floor(requests++/3)];assert.ok(plan,'only expected fixture requests are allowed');const query={select(){return query},order(){return query},then(yes,no){return plan.promise.then(result=>result[table]).then(yes,no)}};return query;}};
  const window={nexerpAuth:{client,profile:{id:'actor-a',organizationId:'organization-a'}}};
  const sandbox={window,showToast:(message,type)=>toasts.push({message,type}),refreshRoleOptions:()=>{},renderSettings:()=>renders.push(sandbox.state())};
  runInNewContext('let users=[],roles=[],usersBackedBySupabase=false;\n'+loaderCode+'\nthis.load=loadUserManagementData;this.state=()=>JSON.parse(JSON.stringify({users,roles,usersBackedBySupabase}));',sandbox);
  return{...sandbox,window,plans,toasts,renders};
}

test('late initial user snapshot cannot overwrite the newer post-invitation refresh',async()=>{
  const f=loaderFixture(),old=defer(),fresh=defer();f.plans.push(old,fresh);
  const first=f.load(),second=f.load();
  fresh.resolve(fixtureResult('New employee'));assert.equal(await second,true);
  old.resolve(fixtureResult('Old snapshot'));assert.equal(await first,false);
  assert.equal(f.state().users[0].firstName,'New employee');assert.equal(f.renders.length,1);assert.deepEqual(f.toasts,[]);
});

test('authorization context replacement prevents previous actor data from rendering',async()=>{
  const f=loaderFixture(),pending=defer();f.plans.push(pending);const loading=f.load();
  f.window.nexerpAuth={...f.window.nexerpAuth,profile:{id:'actor-b',organizationId:'organization-b'}};
  pending.resolve(fixtureResult('Private old actor'));assert.equal(await loading,false);
  assert.equal(f.state().users.length,0);assert.equal(f.renders.length,0);assert.deepEqual(f.toasts,[]);
});

test('mutating the captured actor organization also invalidates the response',async()=>{
  const f=loaderFixture(),pending=defer();f.plans.push(pending);const loading=f.load();
  f.window.nexerpAuth.profile.organizationId='organization-b';
  pending.resolve(fixtureResult('Old organization'));assert.equal(await loading,false);assert.equal(f.renders.length,0);
});

test('current refresh failure is visible and preserves the known snapshot without inventing a new user',async()=>{
  const f=loaderFixture(),first=defer(),failed=defer();f.plans.push(first,failed);
  const initial=f.load();first.resolve(fixtureResult('Known user'));assert.equal(await initial,true);
  const next=f.load();failed.resolve({profiles:{data:null,error:{code:'42501',message:'private failure'}},roles:{data:[]},user_roles:{data:[]}});
  assert.equal(await next,false);assert.equal(f.state().users[0].firstName,'Known user');assert.equal(f.renders.length,1);
  assert.equal(f.toasts.length,1);assert.equal(f.toasts[0].type,'error');assert.ok(!f.toasts[0].message.includes('private failure'));
});

test('failure of a superseded load does not replace newer success with a stale error',async()=>{
  const f=loaderFixture(),old=defer(),fresh=defer();f.plans.push(old,fresh);const first=f.load(),second=f.load();
  fresh.resolve(fixtureResult('Fresh'));assert.equal(await second,true);old.reject(new Error('private old failure'));
  assert.equal(await first,false);assert.equal(f.state().users[0].firstName,'Fresh');assert.deepEqual(f.toasts,[]);
});

function inviteFixture({refresh=true}={}){
  const pending=defer(),calls=[],toasts=[];let resets=0,closes=0,loads=0;
  const button={disabled:false,setAttribute(){},removeAttribute(){}};
  const values={lastName:'Synthetic',firstName:'Staff',email:'synthetic@example.invalid',phone:'99000000',department:'Test',position:'Test',role:'role',startDate:'',active:'on'};
  const userForm={querySelector:()=>button,reset(){resets++;}};
  const window={nexerpAuth:{invokeAuthenticated:async(...args)=>{calls.push(args);return pending.promise;}}};
  const sandbox={window,userForm,FormData:class{get(key){return values[key];}},showToast:(message,type)=>toasts.push({message,type}),closeUserModal:()=>{closes++;},loadUserManagementData:async()=>{loads++;return refresh;}};
  runInNewContext(submitCode,sandbox);
  return{window,userForm,button,pending,calls,toasts,state:()=>({resets,closes,loads})};
}

test('invite double-submit remains one POST; accepted invite plus refresh failure shows a precise partial-success warning',async()=>{
  const f=inviteFixture({refresh:false}),event={preventDefault(){}};
  const first=f.userForm.onsubmit(event);await f.userForm.onsubmit(event);assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);
  f.pending.resolve({ok:true,message:'Invitation accepted'});await first;
  assert.equal(f.calls.length,1);assert.deepEqual(f.state(),{resets:1,closes:1,loads:1});assert.equal(f.button.disabled,false);
  assert.equal(f.toasts.length,1);assert.equal(f.toasts[0].type,'error');assert.match(f.toasts[0].message,/Урилга илгээгдсэн/);assert.match(f.toasts[0].message,/жагсаалтыг шинэчилж чадсангүй/);
});

test('an invitation completion from the previous authorization context cannot reset a new actor form',async()=>{
  const f=inviteFixture(),first=f.userForm.onsubmit({preventDefault(){}});
  f.window.nexerpAuth={invokeAuthenticated:async()=>({ok:true})};f.pending.resolve({ok:true});await first;
  assert.deepEqual(f.state(),{resets:0,closes:0,loads:0});assert.deepEqual(f.toasts,[]);
});
