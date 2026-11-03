/** 家長區資料頁共用的格式化 */
export function fmtDateTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(n / 1024 ** 2)} MB`
}
