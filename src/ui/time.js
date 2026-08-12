export function formatTaskTime(iso, nowValue = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(d.getTime()) || Number.isNaN(now.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  const monthDay = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;
  return `${d.getFullYear()}-${monthDay} ${time}`;
}
