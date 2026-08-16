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

export function formatElapsedTime(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}分${restSeconds}秒` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}小时${restMinutes}分` : `${hours}小时`;
}

export function formatWorkTiming(unit, nowValue = new Date()) {
  const issuedAt = unit?.issuedAt || null;
  const startedAt = unit?.startedAt || null;
  const updatedAt = unit?.updatedAt || null;
  const completedAt = unit?.completedAt || null;
  if (completedAt) {
    const start = startedAt || issuedAt;
    if (!start) return `完成 ${formatTaskTime(completedAt, nowValue)}`;
    const elapsed = formatElapsedTime(start, completedAt);
    return `${formatTaskTime(start, nowValue)} → ${formatTaskTime(completedAt, nowValue)}${elapsed ? ` · ${elapsed}` : ''}`;
  }
  if (startedAt) {
    const started = formatTaskTime(startedAt, nowValue);
    const updated = updatedAt ? formatTaskTime(updatedAt, nowValue) : '';
    if (updated && updatedAt !== startedAt) return `开始 ${started} · 最近活动 ${updated}`;
    return `开始 ${started}`;
  }
  if (issuedAt) return `签发 ${formatTaskTime(issuedAt, nowValue)}`;
  if (updatedAt) return `最近活动 ${formatTaskTime(updatedAt, nowValue)}`;
  return '';
}
