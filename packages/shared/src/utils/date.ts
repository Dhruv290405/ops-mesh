export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseDate(dateString: string): Date {
  return new Date(dateString);
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function diffMinutes(start: Date, end: Date = new Date()): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

export function isOlderThan(date: Date, minutes: number): boolean {
  return diffMinutes(date) > minutes;
}