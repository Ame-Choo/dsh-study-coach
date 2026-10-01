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
 *
 * 注意区分两种 404：**「unknown study route」是旧代码**（路由表里根本没这条），
 * `/study/file?path=` 空参数那种 404 是**新代码的正常回答**（只放行登记过的材料）。
 * 所以判据是「状态码 + 响应体」，不是光看状态码。
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
  // 下面这几条是「分页面 + 多科目 + 对话页 + 错题本 + 复盘图」那几批，最容易漏判：
  ['/study/today', '子页面'],
  ['/study/api/tasks?all=1', '多科目'],
  ['/study/api/chat/sessions', '对话通道'],
  ['/study/api/chat', '对话快照'],
  ['/study/api/mistakes', '错题本'],
  ['/study/api/review', '今日复盘图'],
  // 资料库那批：书架、单本详情
  // 注意别拿 /study/api/point/pages 当探针——旧服务端那条 `/study/api/point/:id`
  // 会把 `pages` 当成单元 id 接住，回 200，新旧分不出来。
  ['/study/materials', '资料页'],
  ['/study/api/materials', '书架'],
  // 工具栏目那批
  ['/study/toolbox', '工具页'],
  ['/study/api/toolbox', '工具数据'],
  // 记忆卡那批
  ['/study/api/memory', '记忆卡'],
]

/** 前端那几个必须出现的记号：现读磁盘，所以能直接看出前端是哪一代。 */
const MARKS = [
  ['probeCapabilities', '能力探测'],
  ['resolvePage', '分页面'],
  ['chatCard', '对话页'],
  ['openFirstCard', '侧栏自动展开'],
  ['mistakesCard', '错题本'],
  ['reviewCard', '今日复盘图'],
  ['shelfCard', '资料书架'],
  ['pomodoroCard', '番茄钟'],
  ['checklistCard', '清单'],
  ['memoryCard', '记忆卡'],
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
    const missing = MARKS.filter(([needle]) => !js.includes(needle)).map(([, label]) => label)
    if (missing.length) bad += 1
    console.log(
      `  静态资源：panel.js ${js.length} 字节，` +
        (missing.length ? `缺 ${missing.join(' / ')}（旧前端，刷新一下就好）` : '记号齐全（新前端）'),
    )
  } catch {
    /* 面板都没起来，上面那排已经说明了 */
  }
}

console.log(bad ? `\n有 ${bad} 处还是旧的 —— 重启一次 DSH` : '\n全是新的')
process.exit(bad ? 1 : 0)
