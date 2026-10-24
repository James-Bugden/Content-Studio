/** Same Taipei wall-clock date/time shown on the slot picker, independent of browser timezone. */
export function slotLabel(isoDate: string, time: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? `${date} \u00b7 ${time}` : date;
}
