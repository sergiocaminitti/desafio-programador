import { describe, it, expect } from 'vitest';
import { generateTimeCardExcel, generatePayrollExcel } from '../src/exporters/excel-exporter.js';
import { generateTimeCardCsv, generatePayrollCsv } from '../src/exporters/csv-exporter.js';
import { TimeCardValue, PayrollValue } from '../src/shared/types.js';

describe('Spreadsheet & File Exporters', () => {
  it('deve gerar planilha Excel válida com cabeçalhos e pares Entrada/Saída', async () => {
    const timeCard: TimeCardValue = {
      pages: [
        {
          page: 1,
          days: [
            {
              date_raw: '21/05/2019',
              punches: [
                { kind: 'IN', time_raw: '08:25', time_hhmm: '08:25' },
                { kind: 'OUT', time_raw: '18:25', time_hhmm: '18:25' },
              ],
            },
            { date_raw: '25/05/2019', punches: [] },
          ],
        },
      ],
    };

    const excelBuffer = await generateTimeCardExcel(timeCard);
    expect(excelBuffer).toBeInstanceOf(Buffer);
    expect(excelBuffer.length).toBeGreaterThan(1000);

    const csv = generateTimeCardCsv(timeCard);
    expect(csv).toContain('Data');
    expect(csv).toContain('Entrada 1');
    expect(csv).toContain('Saída 1');
    expect(csv).toContain('21/05/2019');
  });

  it('deve gerar planilha de Holerite com colunas de verbas transpostas', async () => {
    const payroll: PayrollValue = {
      pages: [
        {
          page: 1,
          year: '2020',
          month: '01',
          fields: [
            { code: '0010', label: 'Salário Base', reference: '220,00', value: '2.389,77' },
            { code: '5560', label: 'Horas Extras - 50%', reference: '8,00', value: '155,91' },
          ],
          bases: [
            { label: 'Base INSS', value: '2.545,68' },
          ],
        },
      ],
    };

    const excelBuffer = await generatePayrollExcel(payroll);
    expect(excelBuffer).toBeInstanceOf(Buffer);
    expect(excelBuffer.length).toBeGreaterThan(1000);

    const csv = generatePayrollCsv(payroll);
    expect(csv).toContain('Pág.');
    expect(csv).toContain('Mês');
    expect(csv).toContain('Ano');
    expect(csv).toContain('Salário Base');
    expect(csv).toContain('Horas Extras - 50%');
    expect(csv).toContain('2.389,77');
  });
});
