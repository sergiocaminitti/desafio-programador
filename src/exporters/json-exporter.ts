import { TranscriptionValue } from '../shared/types.js';

/**
 * Gera a saída JSON canônica formatada.
 */
export function generateJson(value: TranscriptionValue): string {
  return JSON.stringify(value, null, 2);
}
