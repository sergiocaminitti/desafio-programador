import {
  DocumentType,
  TranscriptionValue,
  TimeCardValue,
  PayrollValue,
} from '../shared/types.js';

function escapeCsvCell(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Gera CSV para Cartão de Ponto.
 */
export function generateTimeCardCsv(value: TimeCardValue): string {
  let maxPunches = 0;
  for (const page of value.pages) {
    for (const day of page.days) {
      if (day.punches.length > maxPunches) {
        maxPunches = day.punches.length;
      }
    }
  }

  const numPairs = Math.max(1, Math.ceil(maxPunches / 2));
  const headers = ['Data'];
  for (let i = 1; i <= numPairs; i++) {
    headers.push(`Entrada ${i}`, `Saída ${i}`);
  }

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const page of value.pages) {
    for (const day of page.days) {
      const row: (string | null)[] = [day.date_raw];
      for (let i = 0; i < numPairs * 2; i++) {
        const punch = day.punches[i];
        row.push(punch ? punch.time_raw : '');
      }
      lines.push(row.map(escapeCsvCell).join(','));
    }
  }

  // Adiciona BOM UTF-8 para abertura perfeita no Excel
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Gera CSV para Holerite (matriz transposta).
 */
export function generatePayrollCsv(value: PayrollValue): string {
  const distinctLabels: string[] = [];
  for (const page of value.pages) {
    for (const field of page.fields) {
      if (field.label && !distinctLabels.includes(field.label)) {
        distinctLabels.push(field.label);
      }
    }
  }

  const headers = ['Pág.', 'Mês', 'Ano', ...distinctLabels];
  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const page of value.pages) {
    const row: (string | number)[] = [page.page, page.month, page.year];
    for (const label of distinctLabels) {
      const field = page.fields.find((f) => f.label === label);
      row.push(field ? field.value : '');
    }
    lines.push(row.map(escapeCsvCell).join(','));
  }

  // ── Seção de Bases e Totais ──
  const hasAnyBase = value.pages.some((p) => p.bases.length > 0);
  if (hasAnyBase) {
    const baseHeaders = ['Pág.', 'Mês', 'Ano', 'Base / Total', 'Valor'];
    lines.push('', ''); // Separador visual
    lines.push(baseHeaders.map(escapeCsvCell).join(','));
    for (const page of value.pages) {
      for (const base of page.bases) {
        const row: (string | number)[] = [page.page, page.month, page.year, base.label, base.value];
        lines.push(row.map(escapeCsvCell).join(','));
      }
    }
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Gerador genérico de CSV.
 */
export function generateCsv(tipo: DocumentType, value: TranscriptionValue): string {
  if (tipo === 'cartao-ponto') {
    return generateTimeCardCsv(value as TimeCardValue);
  }
  return generatePayrollCsv(value as PayrollValue);
}
