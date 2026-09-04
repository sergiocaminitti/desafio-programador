import {
  TimeCardDay,
  PayrollPage,
  WarningHighlight,
  TimeCardValue,
  PayrollValue,
} from './types.js';

/**
 * Valida se um horário no formato HH:MM é válido ou contém '?'
 */
export function isValidTimeOrUncertain(timeStr: string): boolean {
  if (!timeStr) return false;
  const clean = timeStr.trim().replace(/[hH\.]/, ':');
  if (clean.includes('?')) return true; // Incerteza é aceita como flag
  
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Valida se um valor monetário está no formato aceitável (dígitos, '.', ',', '?')
 */
export function isValidBrazilianCurrency(val: string): boolean {
  if (!val || val.trim() === '') return true;
  const clean = val.trim();
  // Formato: opcional sinal negativo, dígitos, separadores de milhar (.), vírgula decimal e '?'
  return /^-?[\d\.]+,\d{2}$/.test(clean) || /^[\d\.,\?-]+$/.test(clean);
}

/**
 * Deriva os alertas para uma linha de Cartão de Ponto.
 * 
 * Regras:
 * - Amarelo (#FFF3CD): Batidas ímpares, caractere '?' ou data/hora inválida/impossível.
 * - Vermelho (#F8D7DA + borda #DC3545): Data não sequencial no documento.
 * - Precedência: Vermelho vence Amarelo.
 */
export function deriveTimeCardDayWarning(
  day: TimeCardDay,
  prevReadableDate: Date | null,
  currDate: Date | null
): WarningHighlight {
  const reasons: string[] = [];
  let isYellow = false;
  let isRed = false;

  // 1. Validação de Data de Calendário
  const dateHasQuestion = day.date_raw.includes('?');
  if (!dateHasQuestion && currDate === null) {
    isYellow = true;
    reasons.push(`Data inválida ou impossível (${day.date_raw || 'vazio'})`);
  }

  // 2. Batidas ímpares
  if (day.punches.length % 2 !== 0) {
    isYellow = true;
    reasons.push('Número ímpar de batidas (falta entrada ou saída)');
  }

  // 3. Incerteza ('?')
  const hasUncertainty =
    dateHasQuestion ||
    day.punches.some(
      (p) => p.time_raw.includes('?') || p.time_hhmm.includes('?')
    );
  if (hasUncertainty) {
    isYellow = true;
    reasons.push('Caractere ilegível (?) detectado na data ou nos horários');
  }

  // 4. Validação de Horários Impossíveis (ex: 25:00, 12:88)
  const invalidPunch = day.punches.find((p) => !isValidTimeOrUncertain(p.time_raw));
  if (invalidPunch) {
    isYellow = true;
    reasons.push(`Horário inválido ou impossível (${invalidPunch.time_raw})`);
  }

  // 5. Data não sequencial
  if (currDate && prevReadableDate) {
    // Verifica se a data atual é anterior à anterior ou se quebrou a sequência temporal
    const diffTime = currDate.getTime() - prevReadableDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    // Se data retrocedeu ou se quebrou sequência esperada do mesmo mês/período
    if (diffDays < 0 || diffDays > 31) {
      isRed = true;
      reasons.push(`Data fora de sequência temporal (${day.date_raw})`);
    }
  }

  if (isRed) {
    return {
      color: 'red',
      reasons,
      hasLeftBorder: true,
    };
  }

  if (isYellow) {
    return {
      color: 'yellow',
      reasons,
      hasLeftBorder: false,
    };
  }

  return {
    color: 'none',
    reasons: [],
    hasLeftBorder: false,
  };
}

/**
 * Calcula todos os avisos de um Cartão de Ponto completo (todas as páginas e dias).
 */
export function computeTimeCardWarnings(value: TimeCardValue): Map<string, WarningHighlight> {
  const warnings = new Map<string, WarningHighlight>();
  let lastReadableDate: Date | null = null;

  value.pages.forEach((page) => {
    page.days.forEach((day, dayIndex) => {
      const key = `${page.page}-${dayIndex}`;
      const parsedDate = parseDateString(day.date_raw);

      const highlight = deriveTimeCardDayWarning(day, lastReadableDate, parsedDate);
      warnings.set(key, highlight);

      if (parsedDate) {
        lastReadableDate = parsedDate;
      }
    });
  });

  return warnings;
}

/**
 * Deriva os alertas para uma página de Holerite.
 * 
 * Regras:
 * - Amarelo (#FFF3CD): Página sem dados, caractere '?', valor monetário inválido ou competência inválida.
 * - Vermelho (#F8D7DA + borda #DC3545): Mês não sequencial.
 * - Precedência: Vermelho vence Amarelo.
 */
export function derivePayrollPageWarning(
  page: PayrollPage,
  prevReadable: { year: number; month: number } | null,
  currParsed: { year: number; month: number } | null
): WarningHighlight {
  const reasons: string[] = [];
  let isYellow = false;
  let isRed = false;

  // 1. Página vazia
  if (page.fields.length === 0 && page.bases.length === 0) {
    isYellow = true;
    reasons.push('Página sem dados ou vazia');
  }

  // 2. Incerteza ('?')
  const hasUncertainty =
    page.year.includes('?') ||
    page.month.includes('?') ||
    page.fields.some(
      (f) =>
        f.code.includes('?') ||
        f.label.includes('?') ||
        f.reference.includes('?') ||
        f.value.includes('?')
    ) ||
    page.bases.some((b) => b.label.includes('?') || b.value.includes('?'));

  if (hasUncertainty) {
    isYellow = true;
    reasons.push('Caractere ilegível (?) detectado nos dados do holerite');
  }

  // 3. Validação de Formato Monetário Brasileiro
  const invalidField = page.fields.find((f) => !isValidBrazilianCurrency(f.value));
  if (invalidField) {
    isYellow = true;
    reasons.push(`Valor monetário em formato inválido (${invalidField.label}: ${invalidField.value})`);
  }

  const invalidBase = page.bases.find((b) => !isValidBrazilianCurrency(b.value));
  if (invalidBase) {
    isYellow = true;
    reasons.push(`Valor de base em formato inválido (${invalidBase.label}: ${invalidBase.value})`);
  }

  // 4. Validação de Competência Inválida (ex: mês 13 ou ano inválido)
  if (!hasUncertainty && currParsed === null) {
    isYellow = true;
    reasons.push(`Competência inválida (${page.month}/${page.year})`);
  }

  // 5. Mês não sequencial
  if (currParsed && prevReadable) {
    const isConsecutive = checkConsecutiveMonths(prevReadable, currParsed);
    if (!isConsecutive) {
      isRed = true;
      reasons.push(
        `Competência (${page.month}/${page.year}) não é o mês consecutivo à anterior (${String(prevReadable.month).padStart(2, '0')}/${prevReadable.year})`
      );
    }
  }

  if (isRed) {
    return {
      color: 'red',
      reasons,
      hasLeftBorder: true,
    };
  }

  if (isYellow) {
    return {
      color: 'yellow',
      reasons,
      hasLeftBorder: false,
    };
  }

  return {
    color: 'none',
    reasons: [],
    hasLeftBorder: false,
  };
}

/**
 * Calcula todos os avisos de um Holerite completo (todas as páginas).
 */
export function computePayrollWarnings(value: PayrollValue): Map<number, WarningHighlight> {
  const warnings = new Map<number, WarningHighlight>();
  let lastReadable: { year: number; month: number } | null = null;

  value.pages.forEach((page) => {
    const currParsed = parseCompetence(page.year, page.month);
    const highlight = derivePayrollPageWarning(page, lastReadable, currParsed);
    warnings.set(page.page, highlight);

    if (currParsed) {
      lastReadable = currParsed;
    }
  });

  return warnings;
}

// ==========================================
// HELPERS DE PARSING E CONTINUIDADE
// ==========================================

/**
 * Faz o parsing estrito de datas no calendário real (sem rolagem automática de mês).
 */
export function parseDateString(dateRaw: string): Date | null {
  if (!dateRaw || dateRaw.includes('?')) return null;
  const match = dateRaw.trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Validação estrita de calendário: evita que 31/02 vire 02/03
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }

  return d;
}

export function parseCompetence(yearStr: string, monthStr: string): { year: number; month: number } | null {
  if (!yearStr || !monthStr || yearStr.includes('?') || monthStr.includes('?')) return null;
  const year = parseInt(yearStr.trim(), 10);
  const month = parseInt(monthStr.trim(), 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 1900 || year > 2100) return null;
  return { year, month };
}

export function checkConsecutiveMonths(
  prev: { year: number; month: number },
  curr: { year: number; month: number }
): boolean {
  if (prev.month === 12) {
    return curr.month === 1 && (curr.year === prev.year + 1 || curr.year === prev.year);
  }
  return curr.month === prev.month + 1 && curr.year === prev.year;
}

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
