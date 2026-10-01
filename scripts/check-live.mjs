#!/usr/bin/env node
/**
 * 探一下正在跑的 DSH 到底是新代码还是旧代码。
 *
 * 为什么需要这个：面板的 js / css 是每次请求现读磁盘的，服务端路由是 DSH 启动时
 * 加载的。改完 lib/ 没重启，就会出现「页面是新的、接口全 404」这种最难查的状态。
 *
 *   node scripts/check-live.mjs                     # 默认探 19387 和 19388
 *   node scripts/check-live.mjs 19387 19390         # 想探哪几个端口就写哪几个
 *
 * 退出码 0 = 都齐了；1 = 有缺的（说明进程里跑的还是旧代码，得重启）。
 */
const ports = process.argv.slice(2).map(Number).filter(Boolean)
if (!ports.length) ports.push(19387, 19388)

/** 一条路由至少得能回话（不是 404 unknown study route）。 */
const ROUTES = [
  ['/study', '面板'],
  ['/study/api/state', '档案'],
  ['/study/api/summary', '汇总'],
  ['/study/api/ability', '总体能力'],
  ['/study/api/library', '学习目标库'],
  ['/study/api/archive?level=group&key=', '每级档案'],
  ['/study/practice', '做题页'],
  ['/study/file?path=', '打开文件'],
]

let bad = 0

for (const port of ports) {
  const base = `http://127.0.0.1:${port}`
  console.log(`===== ${base}`)
  for (const [path, label] of ROUTES) {
    try {
      const res = await fetch(base + path)
      const text = await res.text()
      const stale = res.status === 404 && text.includes('unknown study route')
      if (stale) bad += 1
      console.log(`  ${stale ? '旧' : '新'}  ${String(res.status).padEnd(4)} ${label.padEnd(6)} ${path}`)
    } catch (error) {
      console.log(`  ??  ERR  ${label.padEnd(6)} ${path}  (${error.message})`)
    }
  }
  try {
    const js = await (await fetch(base + '/study/assets/panel.js')).text()
    const hasProbe = js.includes('probeCapabilities')
    console.log(`  静态资源：panel.js ${js.length} 字节，${hasProbe ? '带能力探测（新）' : '不带（旧）'}`)
  } catch {
    /* 面板都没起来，上面那排已经说明了 */
  }
}

console.log(bad ? `\n有 ${bad} 条还是旧的 —— 重启一次 DSH` : '\n全是新的')
process.exit(bad ? 1 : 0)
