import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifySource, verifyPublishedPackage } from './verify-upstream-candidate.mjs'

test('source gate rejects a wrong remote, revision, tracked edit, or untracked file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-source-gate-'))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  try {
    git('init', '--quiet')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'user.name', 'Gate fixture')
    git('remote', 'add', 'origin', 'https://example.invalid/upstream.git')
    fs.writeFileSync(path.join(dir, 'source.txt'), 'official fixture\n')
    git('add', 'source.txt')
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
    git('tag', 'test-release')
    const pin = { repository: 'https://example.invalid/upstream.git', commit: git('rev-parse', 'HEAD'), tag: 'test-release' }
    assert.equal(verifySource(dir, pin), pin.commit)
    assert.throws(() => verifySource(dir, { ...pin, repository: 'https://example.invalid/wrong.git' }), /remote mismatch/)
    assert.throws(() => verifySource(dir, { ...pin, commit: '0'.repeat(40) }), /revision mismatch/)
    fs.appendFileSync(path.join(dir, 'source.txt'), 'product edit\n')
    assert.throws(() => verifySource(dir, pin), /source is not byte-clean/)
    fs.writeFileSync(path.join(dir, 'source.txt'), 'official fixture\n')
    fs.writeFileSync(path.join(dir, 'product.txt'), 'unexpected\n')
    assert.throws(() => verifySource(dir, pin), /source is not byte-clean/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('runtime gate rejects corrupt tarballs and modified installed package bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-work-runtime-gate-'))
  const installed = path.join(dir, 'package')
  const tarball = path.join(dir, 'runtime.tgz')
  try {
    fs.mkdirSync(path.join(installed, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: '@test/runtime', version: '1.0.0', bin: { dsh: 'lib/bin.js' } }))
    fs.writeFileSync(path.join(installed, 'lib/bin.js'), 'official bytes\n')
    execFileSync('tar', ['-czf', tarball, '-C', dir, 'package'])
    const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}`
    const pin = { package: '@test/runtime', version: '1.0.0', integrity }
    assert.equal(verifyPublishedPackage(tarball, installed, pin), 2)
    assert.throws(() => verifyPublishedPackage(tarball, installed, { ...pin, integrity: 'sha512-wrong' }),
      error => error?.code === 'package-archive-failed' && /integrity mismatch/.test(error.message))
    assert.throws(() => verifyPublishedPackage(tarball, installed, { ...pin, version: '2.0.0' }),
      error => error?.code === 'package-metadata-mismatch' && /version mismatch/.test(error.message))
    fs.rmSync(path.join(installed, 'package.json'))
    assert.throws(() => verifyPublishedPackage(tarball, installed, pin),
      error => error?.code === 'package-metadata-unavailable' && !String(error).includes(installed))
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: '@test/runtime', version: '1.0.0', bin: { dsh: 'lib/bin.js' } }))
    fs.appendFileSync(path.join(installed, 'lib/bin.js'), 'product patch\n')
    assert.throws(() => verifyPublishedPackage(tarball, installed, pin),
      error => error?.code === 'package-bytes-failed' && /installed package differs/.test(error.message))
    fs.writeFileSync(path.join(installed, 'lib/bin.js'), 'official bytes\n')
    fs.writeFileSync(path.join(installed, 'lib/package.json'), '{"type":"module"}')
    assert.throws(() => verifyPublishedPackage(tarball, installed, pin),
      error => error?.code === 'package-inventory-failed' && /inventory differs/.test(error.message))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
