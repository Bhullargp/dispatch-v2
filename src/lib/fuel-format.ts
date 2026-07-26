export function formatFuelOdometerInput(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (Number.isFinite(parsed)) return Math.trunc(parsed).toString();

  return String(value);
}
