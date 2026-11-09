// Datas e horas da agenda sempre no fuso de São Paulo (o da barbearia),
// não no fuso do computador de quem está usando o painel.

const TIME_ZONE = 'America/Sao_Paulo';
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface SpParts {
  /** "2026-11-05" */
  ymd: string;
  /** Minutos desde a meia-noite (09:30 = 570). */
  minutes: number;
  /** 0 = domingo ... 6 = sábado */
  dow: number;
}

/** Data, hora e dia da semana de um instante, em São Paulo. */
export function spParts(date: Date): SpParts {
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
    dow: WEEKDAYS_EN.indexOf(get('weekday')),
  };
}

export const todaySp = () => spParts(new Date()).ymd;

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(ymd: string, days: number): string {
  return new Date(ymdToUtc(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): number {
  return new Date(ymdToUtc(ymd)).getUTCDay();
}

/** "2026-11-05" -> "05/11" */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

/** 570 -> "09:30" (aceita 1440 = "24:00"). */
export function minutesToHhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "09:30:00" -> 570 */
export function hhmmToMinutes(value: string): number {
  const [h, m] = value.slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Dia + minutos no horário de São Paulo -> instante real.
 * (Funciona mesmo se o Brasil voltar a ter horário de verão.)
 */
export function spToDate(ymd: string, minutes: number): Date {
  const guess = ymdToUtc(ymd) + minutes * 60_000 + 3 * 3_600_000; // SP costuma ser UTC-3
  const p = spParts(new Date(guess));
  const dayDiff = (ymdToUtc(p.ymd) - ymdToUtc(ymd)) / 86_400_000;
  const diff = dayDiff * 1440 + p.minutes - minutes;
  return new Date(guess - diff * 60_000);
}

/** Minutos do instante contados a partir da meia-noite (SP) do dia informado. */
export function minutesFromDayStart(iso: string, ymd: string): number {
  return Math.round((new Date(iso).getTime() - spToDate(ymd, 0).getTime()) / 60_000);
}

/** "1h30", "30 min", "2h" */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
