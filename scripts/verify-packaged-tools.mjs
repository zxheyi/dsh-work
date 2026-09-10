import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Called only by the isolated probe, after PTY exit and all assertions. Windows
// ConPTY worker handles can outlive the terminal; they must not hang this probe.
export function completeToolProbe(result) {
  process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0))
}

export function verifyPackagedTools(resources) {
  const application = path.join(resources, 'app')
  const nodeDirectory = path.join(resources, 'runtime/node', process.platform === 'win32' ? '' : 'bin')
  const node = path.join(nodeDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
  const systemPaths = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
    : ['/usr/bin', '/bin']
  const program = String.raw`
    const complete = ${completeToolProbe.toString()};
    const assert = require('node:assert/strict');
    const pty = require('node-pty');
    const sharp = require('sharp');
    const timeout = setTimeout(() => { console.error('packaged tools timed out'); process.exit(1) }, 25000);
    (async () => {
      const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).resize(1, 1).png().toBuffer();
      assert.equal((await sharp(png).metadata()).width, 1);
      const win = process.platform === 'win32';
      const shell = win ? require('node:path').join(process.env.SystemRoot, 'System32/cmd.exe') : '/bin/sh';
      const command = win ? 'node --version && call npm --version && call npx --version && echo DSH_PTY_OK' : 'node --version && npm --version && npx --version && printf DSH_PTY_OK';
      const terminal = pty.spawn(shell, win ? ['/d', '/s', '/c', command] : ['-c', command], { name: 'xterm', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
      let output = '';
      terminal.onData(data => { output += data });
      terminal.onExit(({ exitCode }) => {
        assert.equal(exitCode, 0, output);
        assert.ok(output.includes('DSH_PTY_OK'), output);
        clearTimeout(timeout);
        complete({ node: process.versions.node, npm: true, npx: true, pty: true, sharp: true });
      });
    })().catch(error => { console.error(error); process.exit(1) });
  `
  const result = execFileSync(node, ['-e', program], {
    cwd: application, env: { ...process.env, PATH: [nodeDirectory, ...systemPaths].join(path.delimiter) },
    timeout: 30000, encoding: 'utf8',
  })
  return JSON.parse(result.trim())
}
