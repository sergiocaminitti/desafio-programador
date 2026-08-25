import { describe, it, expect } from 'vitest';
import {
  normalizeTimeHHMM,
  isValidOrUncertainTime,
  parseTimeCardLine,
} from '../src/core/time-card-extractor.js';

describe('Time Card Extractor', () => {
  it('deve normalizar horários corretamente preservando incertezas (?)', () => {
    expect(normalizeTimeHHMM('8:25')).toBe('08:25');
    expect(normalizeTimeHHMM('08:25')).toBe('08:25');
    expect(normalizeTimeHHMM('08h25')).toBe('08:25');
    expect(normalizeTimeHHMM('0?:25')).toBe('0?:25');
    expect(normalizeTimeHHMM('1?:??')).toBe('1?:??');
  });

  it('deve validar horários possíveis e rejeitar impossíveis', () => {
    expect(isValidOrUncertainTime('08:25')).toBe(true);
    expect(isValidOrUncertainTime('23:59')).toBe(true);
    expect(isValidOrUncertainTime('00:00')).toBe(true);
    expect(isValidOrUncertainTime('0?:25')).toBe(true); // Incerteza é aceita
    expect(isValidOrUncertainTime('25:00')).toBe(false); // Impossível
    expect(isValidOrUncertainTime('12:88')).toBe(false); // Impossível
  });

  it('deve extrair batidas alternadas IN/OUT e linha vazia', () => {
    const lineWithPunches = {
      y: 100,
      text: '21/05/2019 08:25 12:00 13:00 18:25',
      tokens: [],
    };

    const parsed = parseTimeCardLine(lineWithPunches);
    expect(parsed).not.toBeNull();
    expect(parsed?.date_raw).toBe('21/05/2019');
    expect(parsed?.punches.length).toBe(4);
    expect(parsed?.punches[0]).toEqual({ kind: 'IN', time_raw: '08:25', time_hhmm: '08:25' });
    expect(parsed?.punches[1]).toEqual({ kind: 'OUT', time_raw: '12:00', time_hhmm: '12:00' });
    expect(parsed?.punches[2]).toEqual({ kind: 'IN', time_raw: '13:00', time_hhmm: '13:00' });
    expect(parsed?.punches[3]).toEqual({ kind: 'OUT', time_raw: '18:25', time_hhmm: '18:25' });

    // Dia sem batidas (ex: domingo / folga)
    const lineEmptyDay = {
      y: 80,
      text: '25/05/2019 DSR / FOLGA',
      tokens: [],
    };
    const parsedEmpty = parseTimeCardLine(lineEmptyDay);
    expect(parsedEmpty).not.toBeNull();
    expect(parsedEmpty?.date_raw).toBe('25/05/2019');
    expect(parsedEmpty?.punches).toEqual([]);
  });
});
