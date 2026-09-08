import { app } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readLiveSessionLog } from './support/live-release-evidence.ts'
import type { DesktopSession } from '../apps/desktop/main.ts'
const home = process.env.DSH_WORK_E2E_HOME!
if (!home) throw new Error('Isolated live acceptance home required')
app.setPath('userData', path.join(home, 'desktop-user-data'))
app.commandLine.appendSwitch('disable-background-networking')
const relaunch = process.argv.includes('--relaunch')
const output = path.resolve(`artifacts/live-release/${relaunch ? 'desktop-relaunch' : 'desktop'}.json`)
let step = 'boot'
const completed: string[] = []
const report = (status: string) => fs.writeFileSync(output, JSON.stringify({
  status, step, completed, platform: process.platform, arch: process.arch,
  runId: process.env.DSH_WORK_E2E_RUN_ID, fixtureModel: false,
}, null, 2))
report('fail')
const entry: string = '../dist/apps/desktop/main.js'
const { desktop } = await import(entry) as {desktop: Promise<DesktopSession>}
async function run(): Promise<void> {
  let active: DesktopSession | undefined
  const wait = async (read: () => Promise<boolean>): Promise<void> => {
    fs.writeFileSync(path.resolve('artifacts/live-release/desktop-wait.json'),JSON.stringify({step,at:new Error().stack?.split('\n')[2]?.match(/tests\/[^)]+/)?.[0]}))
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) { try { if (await read()) return } catch {}
      await new Promise(resolve=>setTimeout(resolve,100)) }
    throw new Error('Acceptance timeout')
  }
  try {
    active = await desktop
    const { window, host } = active
    const js = <T=unknown>(source: string): Promise<T> => window.webContents.executeJavaScript(source) as Promise<T>
    step = 'reuse-profile'; report('fail')
    if(!relaunch) {
      await wait(() => js<boolean>(`Boolean(document.getElementById('use-local')) && !document.getElementById('use-local').disabled`))
      await js(`document.getElementById('use-local').click()`)
    }
    step = 'native-profile-surface'; report('fail')
    await wait(() => js<boolean>(`(() => {for(const label of ['继续','稍后配置']) Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()===label)?.click();return Boolean(document.querySelector('[data-composer-input]'))})()`))
    step = 'find-history'; report('fail')
    const title=fs.readFileSync(path.join(home,'live-session-title.txt'),'utf8')
    await wait(()=>js<boolean>(`(()=>{
      const expand=Array.from(document.querySelectorAll('button')).find(x=>x.getAttribute('aria-label')==='打开侧边栏');expand?.click();
      const root=Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>x.textContent?.includes('Release validation'));
      if(root?.getAttribute('aria-expanded')==='false')root.click();
      const row=Array.from(document.querySelectorAll('[role=treeitem]')).find(x=>Array.from(x.querySelectorAll('span')).some(s=>s.textContent===${JSON.stringify(title)}));
      if(!row)return false;row.click();return true;
    })()`))
    step = 'read-history'; report('fail')
    await wait(()=>js<boolean>(`document.body.innerText.includes('RELEASE_FIRST_OK')`))
    assert.equal(host.snapshot().state, 'ready')
    completed.push('reuse-profile')
    if(relaunch) {
      const rows=readLiveSessionLog(path.join(home,'sessions')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
      assert.ok(rows.some(row=>row.type==='assistant/chunk' && row.data?.chunk?.type==='block-end'
        && row.data.chunk.block?.type==='text' && row.data.chunk.block.text.includes('RELEASE_BACKGROUND_OK')))
      completed.push('background-result-retained-after-quit')
      step='quit'; report('pass'); app.quit(); return
    }
    step = 'active-window-close'; report('fail')
    await js(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent?.trim()==='新会话')?.click()`)
    await wait(()=>js<boolean>(`Boolean(document.querySelector('[data-composer-input]')) && document.querySelectorAll('[data-chat-turn]').length===0`))
    const prompt = 'Write 150 short numbered sentences about the fictional Project Orchid. Begin your reply with RELEASE_BACKGROUND_OK. Do not use tools.'
    assert.equal(await js(`(async()=>{const input=document.querySelector('[data-composer-input]');input.focus();input.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:${JSON.stringify(prompt)},bubbles:true,cancelable:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return input.textContent})()`),prompt)
    await js(`document.querySelector('button[aria-label="发送消息"]')?.click()`)
    await wait(async () => host.active())
    window.close()
    assert.equal(window.isDestroyed(), false)
    assert.equal(window.isVisible(), false)
    assert.equal(host.snapshot().state, 'ready')
    await wait(async () => !host.active())
    const root = path.join(home, 'sessions')
    const rows = readLiveSessionLog(root).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
    assert.ok(rows.some(row=>row.type==='assistant/chunk' && row.data?.chunk?.type==='block-end'
      && row.data.chunk.block?.type==='text' && row.data.chunk.block.text.includes('RELEASE_BACKGROUND_OK')))
    window.show()
    await wait(() => js<boolean>(`document.body.innerText.includes('RELEASE_BACKGROUND_OK')`))
    completed.push(step)
    step = 'quit'; report('pass')
    // Use the production before-quit shutdown path, not a direct runtime stop.
    app.quit()
  } catch {
    report('fail')
    if(active && !active.window.isDestroyed()) {
      fs.writeFileSync(path.resolve('artifacts/live-release/desktop-failure.png'),(await active.window.webContents.capturePage()).toPNG())
      fs.writeFileSync(path.resolve('artifacts/live-release/desktop-state.json'),JSON.stringify(active.host.snapshot()))
    }
    await active?.host.stop().catch(()=>{})
    await active?.host.dispose().catch(()=>{})
    app.exit(1)
  }
}
void run()
