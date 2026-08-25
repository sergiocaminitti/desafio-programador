import ExcelJS from 'exceljs';
import {
  TimeCardValue,
  PayrollValue,
  DocumentType,
  TranscriptionValue,
} from '../shared/types.js';
import {
  computeTimeCardWarnings,
  computePayrollWarnings,
} from '../shared/warnings.js';

// Cores canônicas do desafio
const HEADER_FILL_COLOR = 'FF173772'; // #173772
const HEADER_FONT_COLOR = 'FFFFFFFF'; // #FFFFFF
const YELLOW_FILL_COLOR = 'FFFFF3CD'; // #FFF3CD
const RED_FILL_COLOR = 'FFF8D7DA';    // #F8D7DA
const RED_BORDER_COLOR = 'FFDC3545';  // #DC3545

/**
 * Gera um arquivo Excel (.xlsx) para Cartão de Ponto com estilização completa.
 */
export async function generateTimeCardExcel(value: TimeCardValue): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cartão de Ponto');

  // 1. Descobre o número máximo de batidas em qualquer dia para determinar o número de pares Entrada/Saída
  let maxPunches = 0;
  for (const page of value.pages) {
    for (const day of page.days) {
      if (day.punches.length > maxPunches) {
        maxPunches = day.punches.length;
      }
    }
  }

  // Número de pares de colunas (Entrada N / Saída N)
  const numPairs = Math.max(1, Math.ceil(maxPunches / 2));

  // 2. Define as colunas do cabeçalho
  const columns: { header: string; key: string; width: number }[] = [
    { header: 'Data', key: 'date', width: 16 },
  ];

  for (let i = 1; i <= numPairs; i++) {
    columns.push({ header: `Entrada ${i}`, key: `in_${i}`, width: 14 });
    columns.push({ header: `Saída ${i}`, key: `out_${i}`, width: 14 });
  }

  worksheet.columns = columns;

  // 3. Estiliza o cabeçalho (Linha 1)
  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = {
      bold: true,
      color: { argb: HEADER_FONT_COLOR },
      size: 11,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // 4. Calcula os avisos para aplicar os realces
  const warnings = computeTimeCardWarnings(value);

  // 5. Preenche as linhas na ordem exata do documento
  let rowIndex = 2;
  for (const page of value.pages) {
    for (let dayIdx = 0; dayIdx < page.days.length; dayIdx++) {
      const day = page.days[dayIdx];
      const warningKey = `${page.page}-${dayIdx}`;
      const highlight = warnings.get(warningKey);

      const rowData: Record<string, string> = {
        date: day.date_raw,
      };

      // Mapeia batidas em Entrada 1, Saída 1, Entrada 2, Saída 2, etc.
      day.punches.forEach((punch, pIdx) => {
        const pairIndex = Math.floor(pIdx / 2) + 1;
        const key = punch.kind === 'IN' ? `in_${pairIndex}` : `out_${pairIndex}`;
        rowData[key] = punch.time_raw;
      });

      const row = worksheet.addRow(rowData);
      row.height = 20;

      // Aplica realce visual nas células da linha
      if (highlight && highlight.color !== 'none') {
        const fillColor = highlight.color === 'red' ? RED_FILL_COLOR : YELLOW_FILL_COLOR;

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: fillColor },
          };

          // Borda esquerda #DC3545 na primeira célula para destaque vermelho
          if (highlight.color === 'red' && colNumber === 1) {
            cell.border = {
              left: { style: 'medium', color: { argb: RED_BORDER_COLOR } },
            };
          }
        });
      }

      rowIndex++;
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Gera um arquivo Excel (.xlsx) para Holerite com matriz transposta e estilização.
 */
export async function generatePayrollExcel(value: PayrollValue): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Holerite');

  // 1. Coleta a união de todas as verbas distintas (labels) na ordem de primeira aparição
  const distinctLabels: string[] = [];
  for (const page of value.pages) {
    for (const field of page.fields) {
      if (field.label && !distinctLabels.includes(field.label)) {
        distinctLabels.push(field.label);
      }
    }
  }

  // 2. Monta as colunas da matriz
  const columns: { header: string; key: string; width: number }[] = [
    { header: 'Pág.', key: 'page', width: 10 },
    { header: 'Mês', key: 'month', width: 10 },
    { header: 'Ano', key: 'year', width: 12 },
  ];

  distinctLabels.forEach((label, idx) => {
    columns.push({ header: label, key: `label_${idx}`, width: 18 });
  });

  worksheet.columns = columns;

  // 3. Estiliza o cabeçalho
  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.font = {
      bold: true,
      color: { argb: HEADER_FONT_COLOR },
      size: 11,
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // 4. Calcula os avisos de holerite
  const warnings = computePayrollWarnings(value);

  // 5. Preenche uma linha por página
  for (const page of value.pages) {
    const highlight = warnings.get(page.page);

    const rowData: Record<string, string | number> = {
      page: page.page,
      month: page.month,
      year: page.year,
    };

    // Mapeia os valores de cada verba nesta página
    distinctLabels.forEach((label, idx) => {
      const field = page.fields.find((f) => f.label === label);
      rowData[`label_${idx}`] = field ? field.value : '';
    });

    const row = worksheet.addRow(rowData);
    row.height = 20;

    // Aplica realce visual
    if (highlight && highlight.color !== 'none') {
      const fillColor = highlight.color === 'red' ? RED_FILL_COLOR : YELLOW_FILL_COLOR;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor },
        };

        // Borda esquerda #DC3545 na primeira célula para alerta vermelho
        if (highlight.color === 'red' && colNumber === 1) {
          cell.border = {
            left: { style: 'medium', color: { argb: RED_BORDER_COLOR } },
          };
        }
      });
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Função unificada para gerar Excel a partir do tipo e do valor.
 */
export async function generateExcel(tipo: DocumentType, value: TranscriptionValue): Promise<Buffer> {
  if (tipo === 'cartao-ponto') {
    return generateTimeCardExcel(value as TimeCardValue);
  }
  return generatePayrollExcel(value as PayrollValue);
}
