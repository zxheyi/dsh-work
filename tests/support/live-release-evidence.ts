import fs from 'node:fs'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
export interface LiveEvent {
  readonly type: string
  readonly data?: {
    readonly turn?: number
    readonly reason?: { readonly kind?: string; readonly error?: { readonly code?: string } }
    readonly message?: { readonly role?: string; readonly content?: readonly { readonly type?: string; readonly text?: string }[] }
    readonly chunk?: { readonly type?: string; readonly block?: { readonly type?: string; readonly text?: string } }
  }
}
/** A user echo, title, or earlier reply cannot prove the requested Agent turn succeeded. */
export function hasCompletedAssistantReply(events: readonly LiveEvent[], turn: number, text: string): boolean {
  return events.some(event => event.type === 'turn/end' && event.data?.turn === turn
    && event.data.reason?.kind === 'completed')
    && events.some(event => {
      if (event.data?.turn !== turn) return false
      const exactLine = (value: string | undefined) => value?.split(/\r?\n/).some(line => line.trim() === text) === true
      if (event.type === 'assistant/message' && event.data.message?.role === 'assistant') {
        return event.data.message.content?.some(block => block.type === 'text' && exactLine(block.text)) === true
      }
      // Keep old isolated alpha.2 evidence readable; V3 folds these chunks into messages.
      return event.type === 'assistant/chunk' && event.data.chunk?.type === 'block-end'
        && event.data.chunk.block?.type === 'text' && exactLine(event.data.chunk.block.text)
    })
}

/** Read only this test's synthetic logs; leave the native default encoding unchanged. */
export function readLiveSessionLog(root: string): string {
  return fs.readdirSync(root, {recursive:true,encoding:'utf8'})
    .filter(file=>file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
    .map(file=>{
      const bytes=fs.readFileSync(path.join(root,file))
      return (file.endsWith('.zstd') ? decodeLiveZstdFrames(bytes) : bytes).toString('utf8')
    }).join('\n')
}

/** Node's one-shot decoder stops at one frame; native logs append multiple frames. */
export function decodeLiveZstdFrames(bytes: Buffer): Buffer {
  const parts: Buffer[] = []
  let offset=0
  while(offset<bytes.length) {
    const result=zstdDecompressSync(bytes.subarray(offset),{info:true}) as unknown as {
      buffer:Buffer; engine:{bytesWritten:number}
    }
    const consumed=result.engine.bytesWritten
    if(!Number.isSafeInteger(consumed) || consumed<=0 || consumed>bytes.length-offset) throw new Error('Invalid Zstandard frame consumption')
    parts.push(result.buffer)
    offset+=consumed
  }
  return Buffer.concat(parts)
}
