const pad = (n: number) => String(n).padStart(2, '0')

/** 本地日期 YYYY-MM-DD */
export function localDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地當天 [start, end) 毫秒範圍 */
export function dayRange(ms: number): [number, number] {
  const d = new Date(ms)
  return [
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  ]
}
