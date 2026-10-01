// 在 CI 里跑测试：把每一个失败的用例变成一条 GitHub 注解。
//
// 为什么要这么做：Actions 的原始日志要登录才能看（`/actions/jobs/:id/logs` 对匿名请求回 403），
// 而注解是公开的——`GET /repos/:owner/:repo/check-runs/:id/annotations` 不登录就能读。
// 于是「CI 红在哪一条」这件事，谁都能查，不用把仓库权限给出去。
//
// 用法：node scripts/ci-test.mjs
// 退出码跟 `node --test` 一致：全绿 0，有用例失败 1。

import { spawn } from 'node:child_process'

const child = spawn(process.execPath, ['--test', '--test-reporter=tap'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
child.stdout.on('data', (chunk) => {
  out += chunk
  process.stdout.write(chunk)
})
child.stderr.on('data', (chunk) => {
  out += chunk
  process.stderr.write(chunk)
})

// 注解正文里的换行、百分号要转义，不然 GitHub 只认第一行
const escape = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

const summarize = (lines, at) => {
  const detail = []
  for (let i = at + 1; i < lines.length && detail.length < 6; i++) {
    if (/^(not )?ok \d+ - /.test(lines[i])) break
    const line = lines[i].trim()
    if (!line) continue
    if (/^(---|\.\.\.)$/.test(line)) continue
    if (/^(duration_ms|type|location|failureType|error|code|expected|actual|operator):/.test(line)) continue
    detail.push(line.replace(/^#\s*/, ''))
  }
  return detail.join(' | ').slice(0, 400)
}

child.on('close', (code) => {
  const lines = out.split(/\r?\n/)
  const failures = []
  const skipped = []
  for (let i = 0; i < lines.length; i++) {
    const bad = /^not ok \d+ - (.*)$/.exec(lines[i])
    if (bad) {
      failures.push({ name: bad[1], detail: summarize(lines, i) })
      continue
    }
    const skip = /^ok \d+ - (.*) # SKIP(.*)$/.exec(lines[i])
    if (skip) skipped.push(skip[1])
  }
  const count = (re) => lines.filter((line) => re.test(line)).length
  const total = count(/^(not )?ok \d+ - /)

  if (failures.length === 0) {
    console.log(`::notice::测试全绿：${total} 条${skipped.length ? `，跳过 ${skipped.length} 条` : ''}`)
  } else {
    for (const item of failures) {
      console.log(`::error title=${escape(item.name)}::${escape(item.detail || '没有更多细节，看上面日志')}`)
    }
    console.log(`::error::${failures.length}/${total} 条用例失败：${escape(failures.map((f) => f.name).join('、'))}`)
  }
  process.exit(code ?? 1)
})
