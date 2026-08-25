import { describe, it, expect } from 'vitest';
import {
  deriveTimeCardDayWarning,
  checkConsecutiveMonths,
  computePayrollWarnings,
  parseDateString,
  isValidTimeOrUncertain,
} from '../src/shared/warnings.js';
import { TimeCardDay, PayrollValue } from '../src/shared/types.js';

describe('Warnings & Highlights Engine', () => {
  it('deve marcar amarelo (#FFF3CD) para batidas ímpares', () => {
    const day: TimeCardDay = {
      date_raw: '21/05/2019',
      punches: [
        { kind: 'IN', time_raw: '08:25', time_hhmm: '08:25' },
        { kind: 'OUT', time_raw: '12:00', time_hhmm: '12:00' },
        { kind: 'IN', time_raw: '13:00', time_hhmm: '13:00' },
      ],
    };

    const warning = deriveTimeCardDayWarning(day, null, new Date(2019, 4, 21));
    expect(warning.color).toBe('yellow');
    expect(warning.hasLeftBorder).toBe(false);
    expect(warning.reasons).toContain('Número ímpar de batidas (falta entrada ou saída)');
  });

  it('deve marcar amarelo (#FFF3CD) para caractere de incerteza (?)', () => {
    const day: TimeCardDay = {
      date_raw: '21/05/2019',
      punches: [
        { kind: 'IN', time_raw: '0?:25', time_hhmm: '0?:25' },
        { kind: 'OUT', time_raw: '18:25', time_hhmm: '18:25' },
      ],
    };

    const warning = deriveTimeCardDayWarning(day, null, new Date(2019, 4, 21));
    expect(warning.color).toBe('yellow');
    expect(warning.reasons).toContain('Caractere ilegível (?) detectado na data ou nos horários');
  });

  it('deve validar datas estritamente e detectar datas impossíveis digitadas pelo usuário (ex: 31/02/2020)', () => {
    expect(parseDateString('29/02/2020')).not.toBeNull(); // Ano bissexto válido
    expect(parseDateString('29/02/2021')).toBeNull(); // Não bissexto -> impossível!
    expect(parseDateString('31/02/2020')).toBeNull(); // Impossível!
    expect(parseDateString('32/05/2019')).toBeNull(); // Impossível!

    const day: TimeCardDay = {
      date_raw: '31/02/2020', // Data impossível sem '?'
      punches: [
        { kind: 'IN', time_raw: '08:00', time_hhmm: '08:00' },
        { kind: 'OUT', time_raw: '17:00', time_hhmm: '17:00' },
      ],
    };

    const parsed = parseDateString(day.date_raw);
    const warning = deriveTimeCardDayWarning(day, null, parsed);
    expect(warning.color).toBe('yellow');
    expect(warning.reasons[0]).toContain('Data inválida ou impossível');
  });

  it('deve detectar horários impossíveis digitados pelo usuário (ex: 25:00 ou 12:88)', () => {
    expect(isValidTimeOrUncertain('08:00')).toBe(true);
    expect(isValidTimeOrUncertain('0?:00')).toBe(true);
    expect(isValidTimeOrUncertain('25:00')).toBe(false);
    expect(isValidTimeOrUncertain('12:88')).toBe(false);

    const day: TimeCardDay = {
      date_raw: '21/05/2019',
      punches: [
        { kind: 'IN', time_raw: '25:00', time_hhmm: '25:00' },
        { kind: 'OUT', time_raw: '17:00', time_hhmm: '17:00' },
      ],
    };

    const parsed = parseDateString(day.date_raw);
    const warning = deriveTimeCardDayWarning(day, null, parsed);
    expect(warning.color).toBe('yellow');
    expect(warning.reasons).toContain('Horário inválido ou impossível (25:00)');
  });

  it('deve marcar vermelho (#F8D7DA + borda) para data não sequencial', () => {
    const prevDate = new Date(2019, 4, 21); // 21/05/2019
    const currDate = new Date(2019, 4, 15); // 15/05/2019 (retrocedeu no tempo!)

    const day: TimeCardDay = {
      date_raw: '15/05/2019',
      punches: [
        { kind: 'IN', time_raw: '08:00', time_hhmm: '08:00' },
        { kind: 'OUT', time_raw: '18:00', time_hhmm: '18:00' },
      ],
    };

    const warning = deriveTimeCardDayWarning(day, prevDate, currDate);
    expect(warning.color).toBe('red');
    expect(warning.hasLeftBorder).toBe(true);
  });

  it('deve garantir que vermelho tem precedência sobre amarelo quando ambos ocorrem', () => {
    const prevDate = new Date(2019, 4, 21);
    const currDate = new Date(2019, 4, 10); // Retrocedeu (vermelho)

    const day: TimeCardDay = {
      date_raw: '10/05/2019',
      punches: [
        { kind: 'IN', time_raw: '0?:00', time_hhmm: '0?:00' }, // Incerteza (amarelo)
      ], // 1 batida = ímpar (amarelo)
    };

    const warning = deriveTimeCardDayWarning(day, prevDate, currDate);
    expect(warning.color).toBe('red'); // Vermelho GANHA
    expect(warning.hasLeftBorder).toBe(true);
  });

  it('deve tratar Dezembro -> Janeiro como consecutivo no holerite', () => {
    expect(checkConsecutiveMonths({ year: 2019, month: 12 }, { year: 2020, month: 1 })).toBe(true);
    expect(checkConsecutiveMonths({ year: 2020, month: 1 }, { year: 2020, month: 2 })).toBe(true);
    expect(checkConsecutiveMonths({ year: 2020, month: 1 }, { year: 2020, month: 3 })).toBe(false);
  });

  it('deve detectar mês não consecutivo e página vazia em holerite multipágina', () => {
    const multiPagePayroll: PayrollValue = {
      pages: [
        {
          page: 1,
          year: '2020',
          month: '01',
          fields: [{ code: '001', label: 'Salário Base', reference: '220', value: '2.500,00' }],
          bases: [{ label: 'Total Vencimentos', value: '2.500,00' }],
        },
        {
          page: 2,
          year: '2020',
          month: '03', // Pulou Fevereiro (02)! Deve dar Vermelho
          fields: [{ code: '001', label: 'Salário Base', reference: '220', value: '2.500,00' }],
          bases: [{ label: 'Total Vencimentos', value: '2.500,00' }],
        },
        {
          page: 3,
          year: '2020',
          month: '04',
          fields: [], // Página vazia! Deve dar Amarelo
          bases: [],
        },
      ],
    };

    const warnings = computePayrollWarnings(multiPagePayroll);

    expect(warnings.get(1)?.color).toBe('none');
    expect(warnings.get(2)?.color).toBe('red');
    expect(warnings.get(2)?.hasLeftBorder).toBe(true);
    expect(warnings.get(2)?.reasons[0]).toContain('não é o mês consecutivo');

    expect(warnings.get(3)?.color).toBe('yellow');
    expect(warnings.get(3)?.reasons[0]).toContain('Página sem dados ou vazia');
  });
});
