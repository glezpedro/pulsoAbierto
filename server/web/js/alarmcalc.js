// Cálculos del despertador semanal (sin dependencias, para poder probarlos).

/** Next occurrence after `from` of a weekly schedule {time: 'HH:MM', days: [1 = lunes … 7 = domingo]}, or null. */
export function nextAlarm(sch, from = new Date()) {
  if (!sch?.time || !sch.days?.length) return null;
  const [h, m] = String(sch.time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0);
    const wd = ((d.getDay() + 6) % 7) + 1;
    if (d > from && sch.days.includes(wd)) return d;
  }
  return null;
}
