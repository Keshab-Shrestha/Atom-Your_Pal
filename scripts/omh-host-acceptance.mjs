// Bounded host integration checks on disposable local data; no model, native UI or product database.
// Run from the repository: node --disable-warning=ExperimentalWarning scripts/omh-host-acceptance.mjs
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openHelperStore,workflowTaskContract,bindPlanWriteScopes,currentWriteScope,writeScopesOverlap,taskFileChecks,fileCheckManifest} from '../services/helpers/src/index.ts';
import {captureVerificationWorkspace,verifyTaskFiles} from '../apps/mac/src/task-file-verification.ts';
const dir=mkdtempSync(join(tmpdir(),'atom-omh-acceptance-')),file=join(dir,'helpers.db'),checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name)};
let store;
try {
store=openHelperStore({path:file,home:dir});
const contract=workflowTaskContract({deliverable:'One Cedar line',scope:'Fictional text only',verify:'Read Friday and heron',stopWhen:'Return, no files or commits'});
assert.throws(()=>workflowTaskContract({...contract,permission:'full'}));pass('Contract rejects injected permission fields');
const p=store.addPlan('cedar',{goal:'Cedar report repair',portions:[{n:1,agent:'quill',task:'Write the Cedar line',after:[],contract},{n:2,agent:'penny',task:'Review the line',after:[1],contract}]});
const job=store.addNativeJob('quill',p.portions[0].task,{chatId:'cedar'});store.linkPlanJob(p.id,1,job.id);store.fail(job.id,'Fictional failure');
assert.equal(store.plan(p.id).portions[1].state,'blocked');
const retry=store.queueNativeRetry(job.id);assert.equal(store.queueNativeRetry(job.id).job.id,retry.job.id);
const retryChat=retry.job.chatId,rp=store.nativeRetryPlan(retryChat).plan;
assert.deepEqual(rp.portions[0].contract,contract);assert.deepEqual(rp.portions[0].after,[]);
assert.equal(rp.portions[0].recovery.kind,'retry-queued');
assert.equal(store.planForChat('other',p.id),undefined);assert.equal(store.planHistory('other').length,0);pass('Retry is deduplicated, inherits contract and remains chat-scoped');
store.addNativeJob('quill','replacement prompt cannot replace saved task',{chatId:retryChat});
assert.throws(()=>store.addNativeJob('quill','duplicate',{chatId:retryChat}));
store.finish(retry.job.id,{title:'Cedar line',summary:'Friday, blue heron',body:'Cedar launches Friday with a blue heron.',sources:[]});
const review=store.preparePlanRepair('cedar',p.id,1,retry.job.id);
assert.throws(()=>store.acceptPlanRepair('cedar',p.id,1,retry.job.id,'0'.repeat(64)));
store.acceptPlanRepair('cedar',p.id,1,retry.job.id,review.reviewDigest);
assert.equal(store.get(job.id).state,'failed');assert.equal(store.plan(p.id).portions[0].resultJob,retry.job.id);assert.equal(store.plan(p.id).portions[1].state,'waiting');
store.acceptPlanRepair('cedar',p.id,1,retry.job.id,review.reviewDigest);pass('Repair binds exact reviewed report; original failure remains; repeated acceptance is idempotent');
const crashPlan=store.addPlan('crash',{goal:'Interrupted fixture',portions:[{n:1,agent:'quill',task:'Unfinished fictional work',after:[],contract}]});
const running=store.addNativeJob('quill','Unfinished fictional work',{chatId:'crash'});store.linkPlanJob(crashPlan.id,1,running.id);
store.close();store=openHelperStore({path:file,home:dir});
assert.equal(store.plan(crashPlan.id).portions[0].recovery.kind,'interrupted');assert.equal(store.runningNativeJobs('crash').length,0);
assert.equal(store.plan(p.id).portions[0].resultJob,retry.job.id);assert.deepEqual(store.plan(p.id).portions[0].contract,contract);pass('Close/reopen preserves contracts and repair, explains interruption without replay');
writeFileSync(join(dir,'cedar.txt'),'Cedar launches Friday with a blue heron.\n');
const declared=taskFileChecks([{kind:'contains',path:'cedar.txt',expected:'Friday'}]);const workspace=captureVerificationWorkspace(dir);
const observe=async(extra={})=>verifyTaskFiles({checks:declared,workspace,attempt:randomUUID(),signal:new AbortController().signal,allowed:()=>true,readAllowed:async()=>true,...extra});
const snapshot=await observe();assert.equal(snapshot.checks[0].state,'matched');assert.equal(snapshot.manifestDigest,fileCheckManifest(declared));
const denied=await observe({readAllowed:async()=>false});assert.equal(denied.checks[0].reason,'policy_refused');
const abort=new AbortController();abort.abort();assert.equal((await observe({signal:abort.signal})).checks[0].reason,'cancelled');
rmSync(join(dir,'cedar.txt'));symlinkSync('/etc/hosts',join(dir,'cedar.txt'));assert.equal((await observe()).checks[0].state,'unavailable');pass('Real file collector matches bounded literal and fails closed for refusal, Stop and symlink');
const bound=bindPlanWriteScopes({goal:'Scope checks',portions:[{n:1,agent:'kame',task:'A',after:[],contract,writeScope:['a.txt']},{n:2,agent:'kame',task:'B',after:[],contract,writeScope:['b.txt']}]},dir);
assert.equal(writeScopesOverlap(currentWriteScope(bound.portions[0],dir),currentWriteScope(bound.portions[1],dir)),false);
assert.throws(()=>currentWriteScope(bound.portions[0],tmpdir()));pass('Disjoint declared scopes stay compatible; project rebinding is refused');
console.log(JSON.stringify({kind:'host-integration-not-provider-or-native-acceptance',passed:checks.length,checks}));
} finally {store?.close();rmSync(dir,{recursive:true,force:true});}
