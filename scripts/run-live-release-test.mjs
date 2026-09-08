import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removeOwnedTestHome } from '../tests/support/owned-test-home.ts'
const require = createRequire(import.meta.url)
const credentialPath = process.argv[2]
const sourceProfile = process.argv[3]
const runId = randomUUID()
const testedAt = new Date().toISOString()
const digest = file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const inputs=['package.json','pnpm-lock.yaml',...['apps','packages','runtime','tests','scripts'].flatMap(root=>fs.readdirSync(root,{recursive:true,encoding:'utf8'})
  .filter(f=>/\.(?:ts|cts|mjs|json|yml)$/.test(f) && !f.split(path.sep).includes('node_modules')).map(f=>path.join(root,f)))].sort()
const sourceDigests=Object.fromEntries(inputs.map(file=>[file.split(path.sep).join('/'),digest(file)]))
if(!sourceProfile || !path.isAbsolute(sourceProfile)) throw new Error('Provide the absolute compatible local Profile directory as the second argument')
if (!credentialPath || !path.isAbsolute(credentialPath)) throw new Error('Provide an absolute local Harness credentials file path; never pass a key as an argument')
if (!process.env.DSH_WORK_NODE) throw new Error('DSH_WORK_NODE must identify verified standalone Node')
const yaml = require(require.resolve('yaml', { paths: [require.resolve('@deepseek-ai/dsh/package.json')] }))
const key = yaml.parse(fs.readFileSync(credentialPath, 'utf8'))?.refs?.DEEPSEEK_API_KEY
if (typeof key !== 'string' || !key) throw new Error('No DEEPSEEK_API_KEY reference in the supplied file')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-live-release-'))
fs.chmodSync(home, 0o700)
// Copy only the explicitly selected provider credential, never browser tokens or private history.
fs.writeFileSync(path.join(home, '.credentials.yaml'), JSON.stringify({ version: 1, refs: { DEEPSEEK_API_KEY: key } }), { mode: 0o600 })
const child = spawn(require('electron'), ['tests/live-release-e2e.ts'], {
  env: { ...process.env, DSH_WORK_E2E_HOME: home, DSH_WORK_E2E_RUN_ID: runId }, stdio: 'ignore', shell: false,
})
try {
  const code = await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 600_000)
    child.once('error', () => { clearTimeout(timeout); resolve(-1) })
    child.once('close', code => { clearTimeout(timeout); resolve(code) })
  })
  const report = JSON.parse(fs.readFileSync('artifacts/live-release/result.json', 'utf8'))
  report.testedAt=testedAt; report.sourceDigests=sourceDigests
  fs.writeFileSync('artifacts/live-release/result.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({...report,sourceDigests:undefined}, null, 2))
  if (code !== 0 || report.status !== 'pass' || report.runId !== runId) process.exitCode = 1
  if (sourceProfile && fs.existsSync(path.join(home, 'live-session-title.txt'))) {
    if (!path.isAbsolute(sourceProfile)) throw new Error('Source Profile must be absolute')
    const sourceFiles = ['package.json', 'cordis.patch.yml'].filter(f=>fs.existsSync(path.join(sourceProfile,f)))
    const before = sourceFiles.map(f=>digest(path.join(sourceProfile,f)))
    fs.writeFileSync(path.join(home,'.credentials.yaml'),JSON.stringify({version:1,refs:{DEEPSEEK_API_KEY:key}}),{mode:0o600})
    fs.writeFileSync(path.join(home,'settings.yaml'),JSON.stringify({'ui-onboarding':{welcomeNoticeVersion:'2026-08-13.1'}}))
    const copy = path.join(home,'profiles/web'); fs.mkdirSync(copy,{recursive:true})
    for (const file of sourceFiles) fs.copyFileSync(path.join(sourceProfile,file),path.join(copy,file))
    if (fs.existsSync(path.join(sourceProfile,'node_modules'))) fs.symlinkSync(path.join(sourceProfile,'node_modules'),path.join(copy,'node_modules'),'junction')
    for(const relaunch of [false,true]) {
      const desktop = spawn(require('electron'), ['tests/live-desktop-lifecycle-e2e.ts', ...(relaunch?['--relaunch']:[])], {
        env:{...process.env,DSH_HOME:home,DSH_WORK_E2E_HOME:home,DSH_WORK_E2E_RUN_ID:runId},stdio:'ignore',shell:false,
      })
      const desktopCode = await new Promise(resolve=>{
        const timeout=setTimeout(()=>desktop.kill('SIGKILL'),240_000)
        desktop.once('error',()=>{clearTimeout(timeout);resolve(-1)})
        desktop.once('close',code=>{clearTimeout(timeout);resolve(code)})
      })
      const resultFile=`artifacts/live-release/${relaunch?'desktop-relaunch':'desktop'}.json`
      const result=JSON.parse(fs.readFileSync(resultFile,'utf8'))
      result.testedAt=testedAt
      result.sourceDigests=sourceDigests
      result.sourceProfileUnchanged=sourceFiles.every((file,i)=>digest(path.join(sourceProfile,file))===before[i])
      result.clonedProfileUnchanged=sourceFiles.every((file,i)=>digest(path.join(copy,file))===before[i])
      result.sourceProfileFiles=sourceFiles
      try {
        const runtime=path.join(home,'desktop-user-data/runtime')
        const active=JSON.parse(fs.readFileSync(path.join(runtime,'active.json'),'utf8'))
        result.cleanShutdown=JSON.parse(fs.readFileSync(path.join(runtime,'generations',active.generation,'dsh-work-terminal.json'),'utf8')).status==='clean'
        result.priorCleanRecovered=!relaunch||fs.existsSync(path.join(runtime,'last-clean.json'))
      } catch {result.cleanShutdown=false}
      if(desktopCode!==0||result.status!=='pass'||result.runId!==runId||!result.sourceProfileUnchanged||!result.clonedProfileUnchanged||!result.cleanShutdown||!result.priorCleanRecovered) {
        result.status='fail';process.exitCode=1
      }
      fs.writeFileSync(resultFile,JSON.stringify(result,null,2))
      console.log(JSON.stringify({...result,sourceDigests:undefined},null,2))
      if(result.status!=='pass')break
    }
  }
} finally { removeOwnedTestHome(home) }
