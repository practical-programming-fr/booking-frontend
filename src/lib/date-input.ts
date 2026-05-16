export function formatDateInputValue(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getRelativeLocalDateInputValue(daysFromToday: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return formatDateInputValue(date);
}

export function addDaysToDateInputValue(value: string, dayOffset: number): string {
  const parsed = parseDateInputValue(value);
  if (!parsed) {
    return value;
  }

  parsed.setDate(parsed.getDate() + dayOffset);
  return formatDateInputValue(parsed);
}

export function getLocalDateInputValue(): string {
  return getRelativeLocalDateInputValue(0);
}

export function getDateInputValueWithOffset(daysFromToday: number): string {
  return getRelativeLocalDateInputValue(daysFromToday);
}

export function addDaysToLocalDateString(daysFromToday: number): string {
  return getRelativeLocalDateInputValue(daysFromToday);
}
