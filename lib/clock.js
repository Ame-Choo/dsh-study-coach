/**
 * 全插件唯一的「今天」口径：北京时间（UTC+8）。
 *
 * 为什么要有这个文件：原来各处的「今天」是 `new Date().toISOString().slice(0, 10)` ——
 * 那是 **UTC 日期**。东八区比 UTC 快八小时，于是本地 00:00—08:00 这八小时里，UTC 还停在
 * 前一天：面板会说「今天还没排任务」（其实今天的清单就在那儿）、番茄钟记的分钟数和复习
 * 到期日也会落到昨天头上。更别扭的是 lib/tools.js 那边用的是**本地**日期，所以教练的工具
 * （study_report 的 today、study_plan 的默认日期）跟面板各说各话，午夜前后正好差一天。
 *
 * 现在统一走这里：把时刻先平移到东八区，再读它的 UTC 年月日，得到的就是北京墙上时间。
 * 固定偏移、不跟机器时区走 —— 学生在北京，他看到的「今天」必须和这里一致，换台机器也一样。
 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 北京时间（UTC+8）的日期，`YYYY-MM-DD`。at 可以是 Date、毫秒数或能被 Date 解析的值。 */
export function beijingDate(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at)
  const t = new Date(d.getTime() + BEIJING_OFFSET_MS)
  if (!Number.isFinite(t.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
