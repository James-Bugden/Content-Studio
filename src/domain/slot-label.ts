/** Same Taipei wall-clock date/time shown on the slot picker, independent of browser timezone. */
export function slotLabel(isoDate: string, time: string): string {
  return `${new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} \u00b7 ${time}`;
}
