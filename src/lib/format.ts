export function compact(n: number, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '–'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(digits) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : digits) + 'K'
  return Math.round(n).toLocaleString()
}
export function money(n: number): string {
  return '$' + compact(n)
}
export function pct(n: number): string {
  return Math.round(n) + '%'
}
export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
