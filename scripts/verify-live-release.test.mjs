import assert from 'node:assert/strict'
import test from 'node:test'
import { validateLiveReceipts } from './verify-live-release.mjs'
const make = () => [
  {status:'pass',fixtureModel:false,runId:'one',completed:['fresh-model-setup-ui','first-live-response','attachment-generate','revision-save','restart-persistence','wrong-key','wrong-key-recovery','connection-refused','connection-refused-recovery']},
  ...[['reuse-profile','active-window-close'],['background-result-retained-after-quit']].map(completed=>({
    status:'pass',fixtureModel:false,runId:'one',completed,sourceProfileUnchanged:true,clonedProfileUnchanged:true,cleanShutdown:true,priorCleanRecovered:true,
  })),
]
test('functional gate refuses partial, fixture, mixed-run and unclean desktop evidence', () => {
  assert.doesNotThrow(()=>validateLiveReceipts(make()))
  for(const mutate of [r=>{r[0].completed.pop()},r=>{r[0].fixtureModel=true},r=>{r[1].runId='other'},r=>{r[2].cleanShutdown=false},r=>{r[1].status='fail'}]) {
    const receipts=make();mutate(receipts);assert.throws(()=>validateLiveReceipts(receipts))
  }
})
