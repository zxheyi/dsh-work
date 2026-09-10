import test from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { hasCompletedAssistantReply, decodeLiveZstdFrames, type LiveEvent } from './support/live-release-evidence.ts'
const reply: LiveEvent = {type:'assistant/chunk',data:{turn:1,chunk:{type:'block-end',block:{type:'text',text:'OK'}}}}
const completed: LiveEvent = {type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}
test('live evidence requires a completed assistant turn, never a user echo or failed output', () => {
  assert.equal(hasCompletedAssistantReply([reply],1,'OK'),false)
  assert.equal(hasCompletedAssistantReply([{...reply,type:'user/message'},completed],1,'OK'),false)
  assert.equal(hasCompletedAssistantReply([reply,{type:'turn/end',data:{turn:1,reason:{kind:'error'}}}],1,'OK'),false)
  assert.equal(hasCompletedAssistantReply([reply,completed],1,'OK'),true)
})
test('live recovery evidence cannot reuse a previous successful reply', () => {
  assert.equal(hasCompletedAssistantReply([reply,completed,{type:'turn/end',data:{turn:2,reason:{kind:'completed'}}}],2,'OK'),false)
  assert.equal(hasCompletedAssistantReply([reply,completed],1,'OTHER'),false)
})

test('live evidence reads every native Zstandard frame', () => {
  const first=zstdCompressSync('header\n'), second=zstdCompressSync('events\n')
  assert.equal(decodeLiveZstdFrames(Buffer.concat([first,second])).toString(),'header\nevents\n')
})

test('live evidence accepts a distinct target line in a completed multi-line assistant reply', () => {
  const multiline: LiveEvent = {type:'assistant/chunk',data:{turn:1,chunk:{type:'block-end',block:{type:'text',text:'PREVIOUS\n\nOK'}}}}
  assert.equal(hasCompletedAssistantReply([multiline,completed],1,'OK'),true)
  assert.equal(hasCompletedAssistantReply([multiline,completed],1,'PREV'),false)
})

test('live evidence consumes the V3 assistant message instead of removed top-level chunks', () => {
  const message = { type: 'assistant/message', data: { turn: 1, message: {
    role: 'assistant', content: [{ type: 'text', text: 'PREVIOUS\nOK' }],
  } } }
  assert.equal(hasCompletedAssistantReply([message, completed], 1, 'OK'), true)
  assert.equal(hasCompletedAssistantReply([{ ...message, type: 'user/message' }, completed], 1, 'OK'), false)
  assert.equal(hasCompletedAssistantReply([message], 1, 'OK'), false)
  assert.equal(hasCompletedAssistantReply([message, completed], 2, 'OK'), false)
})
