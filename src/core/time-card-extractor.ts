import { ExtractedDocument, ExtractedLine } from './pdf-reader.js';
import { TimeCardValue, TimeCardPage, TimeCardDay, Punch } from '../shared/types.js';

// Regex para datas (ex: 21/05/2019, 01/05/19, 21/05, 01-05-2020, 2?/05/2019)
const DATE_REGEX = /\b([0-3\?][0-9\?][\/\-\.][0-1\?][0-9\?](?:[\/\-\.][12\?][0-9\?]{2,4})?|\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\b/;

// Regex para horários de batida (ex: 08:25, 18:25, 0?:25, 8:25, 08h25, 08.25)
const TIME_REGEX = /\b([0-2\?][0-9\?][:hH\.\-][0-5\?][0-9\?]|\b[0-9][:hH\.\-][0-5\?][0-9\?])\b/g;

/**
 * Normaliza um horário para o formato HH:MM (24h), preservando incertezas (?)
 */
export function normalizeTimeHHMM(timeRaw: string): string {
  const clean = timeRaw.trim().replace(/[hH\.]/, ':');
  const parts = clean.split(':');
  if (parts.length !== 2) return timeRaw;

  let [hh, mm] = parts;
  if (hh.length === 1 && !hh.includes('?')) {
    hh = '0' + hh;
  }
  return `${hh}:${mm}`;
}

/**
 * Valida se um horário é teoricamente possível (hora 00-23, min 00-59) ou contém incerteza.
 * Nunca produz hora impossível (ex: 25:00 ou 12:88).
 */
export function isValidOrUncertainTime(timeHhmm: string): boolean {
  if (timeHhmm.includes('?')) return true;
  const [hhStr, mmStr] = timeHhmm.split(':');
  const hh = parseInt(hhStr, 10);
  const mm = parseInt(mmStr, 10);
  if (isNaN(hh) || isNaN(mm)) return false;
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Processa uma linha de texto e tenta extrair o registro do dia do cartão de ponto.
 */
export function parseTimeCardLine(line: ExtractedLine): TimeCardDay | null {
  const text = line.text;

  // Procura por data na linha
  const dateMatch = text.match(DATE_REGEX);
  if (!dateMatch) {
    return null;
  }

  const dateRaw = dateMatch[1];
  const textAfterDate = text.slice((dateMatch.index || 0) + dateMatch[0].length);

  // Procura por horários de batida após a data
  const punches: Punch[] = [];
  const matches = [...textAfterDate.matchAll(TIME_REGEX)];

  let isEntry = true;
  for (const match of matches) {
    const timeRaw = match[1];
    const timeHhmm = normalizeTimeHHMM(timeRaw);

    // Se for um horário válido
    if (isValidOrUncertainTime(timeHhmm)) {
      punches.push({
        kind: isEntry ? 'IN' : 'OUT',
        time_raw: timeRaw,
        time_hhmm: timeHhmm,
      });
      isEntry = !isEntry; // Alterna IN e OUT
    }
  }

  return {
    date_raw: dateRaw,
    punches,
  };
}

/**
 * Extrai a estrutura completa de Cartão de Ponto a partir de um documento PDF lido.
 */
export function extractTimeCard(doc: ExtractedDocument): TimeCardValue {
  const pages: TimeCardPage[] = [];

  for (const page of doc.pages) {
    const days: TimeCardDay[] = [];

    for (const line of page.lines) {
      const dayRecord = parseTimeCardLine(line);
      if (dayRecord) {
        days.push(dayRecord);
      }
    }

    pages.push({
      page: page.pageNumber,
      days,
    });
  }

  return {
    pages,
  };
}
