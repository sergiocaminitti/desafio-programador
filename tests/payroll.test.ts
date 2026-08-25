import { describe, it, expect } from 'vitest';
import { parsePayrollPage, isBaseLabel, extractCompetence } from '../src/core/payroll-extractor.js';

describe('Payroll Extractor', () => {
  it('deve identificar corretamente labels que pertencem à seção de bases e não a fields', () => {
    expect(isBaseLabel('Base INSS')).toBe(true);
    expect(isBaseLabel('Base de Cálculo FGTS')).toBe(true);
    expect(isBaseLabel('Base IRRF')).toBe(true);
    expect(isBaseLabel('Total Vencimentos')).toBe(true);
    expect(isBaseLabel('Total Descontos')).toBe(true);
    expect(isBaseLabel('Valor Líquido')).toBe(true);
    expect(isBaseLabel('Salário Base')).toBe(false);

    expect(isBaseLabel('Horas Extras - 50%')).toBe(false);
    expect(isBaseLabel('Adicional Noturno')).toBe(false);
    expect(isBaseLabel('Vale Transporte')).toBe(false);
  });

  it('deve extrair competência ano e mês do cabeçalho', () => {
    const lines = [
      { y: 500, text: 'EMPRESA EXEMPLO LTDA', tokens: [] },
      { y: 480, text: 'RECIBO DE PAGAMENTO DE SALÁRIO - 01/2020', tokens: [] },
    ];
    const comp = extractCompetence(lines);
    expect(comp).toEqual({ year: '2020', month: '01' });
  });

  it('deve separar estritamente verbas (fields) de bases (bases) e manter valores monetários como string', () => {
    const sampleLines = [
      { y: 500, text: 'DEMONSTRATIVO DE PAGAMENTO 01/2020', tokens: [] },
      { y: 450, text: '0010 Salário Base 220,00 2.389,77', tokens: [] },
      { y: 430, text: '5560 Horas Extras - 50% 8,00 155,91', tokens: [] },
      { y: 410, text: '0998 INSS 262,87', tokens: [] },
      { y: 350, text: 'Bases de Cálculo e Totais', tokens: [] },
      { y: 330, text: 'Base INSS 2.545,68', tokens: [] },
      { y: 310, text: 'Total Vencimentos 2.545,68', tokens: [] },
      { y: 290, text: 'Valor Líquido 2.282,81', tokens: [] },
    ];

    const page = parsePayrollPage(sampleLines, 1);

    expect(page.year).toBe('2020');
    expect(page.month).toBe('01');

    // Fields deve conter APENAS as verbas
    expect(page.fields.length).toBe(3);
    expect(page.fields[0]).toEqual({
      code: '0010',
      label: 'Salário Base',
      reference: '220,00',
      value: '2.389,77',
    });
    expect(page.fields[1]).toEqual({
      code: '5560',
      label: 'Horas Extras - 50%',
      reference: '8,00',
      value: '155,91',
    });
    expect(page.fields[2]).toEqual({
      code: '0998',
      label: 'INSS',
      reference: '',
      value: '262,87',
    });

    // Bases deve conter as bases e totais
    expect(page.bases.length).toBe(3);
    expect(page.bases[0]).toEqual({ label: 'Base INSS', value: '2.545,68' });
    expect(page.bases[1]).toEqual({ label: 'Total Vencimentos', value: '2.545,68' });
    expect(page.bases[2]).toEqual({ label: 'Valor Líquido', value: '2.282,81' });
  });
});
