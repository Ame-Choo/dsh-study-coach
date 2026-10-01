#!/usr/bin/env node
/**
 * 把 package.json 里的仓库地址填成当前 git remote 的地址——省得手改三处。
 *
 *   git remote add origin https://github.com/<你>/dsh-study-coach.git
 *   npm run setup-repo
 *
 * https 和 git@ 两种 remote 写法都认。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'package.json')

function remoteUrl() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** 从任意 GitHub remote 写法里抠出 https://github.com/owner/repo。 */
function httpBase(url) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `https://github.com/${m[1]}/${m[2]}` : null
}

const url = remoteUrl()
if (!url) {
  console.error('没找到 git remote。先跑：git remote add origin <你的仓库地址>')
  process.exit(1)
}

const base = httpBase(url)
if (!base) {
  console.error(`这个 remote 看不出 GitHub 仓库地址：${url}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
pkg.repository = { type: 'git', url: `git+${base}.git` }
pkg.homepage = `${base}#readme`
pkg.bugs = { url: `${base}/issues` }
writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

console.log(`repository → ${pkg.repository.url}`)
console.log(`homepage   → ${pkg.homepage}`)
console.log(`bugs       → ${pkg.bugs.url}`)
