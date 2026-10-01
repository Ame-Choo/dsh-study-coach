/** 六档和配色。面板、图谱、做题页共用一份，别各写各的。
 *
 * 颜色走 CSS 变量（style.css 里 --stage-1..6），因为两套主题要的正好相反：
 * 浅色底上「越靠后越深」，深色底上「越靠后越亮」。写死十六进制就会有一边糊掉。
 */
export const STAGES = ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白']

export const STAGE_COLOR = {
  没接触过: 'var(--stage-1)',
  见过: 'var(--stage-2)',
  能跟做: 'var(--stage-3)',
  能独立做: 'var(--stage-4)',
  熟练稳定: 'var(--stage-5)',
  能讲明白: 'var(--stage-6)',
}
