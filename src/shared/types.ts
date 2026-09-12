/**
 * Tipos canônicos compartilhados entre cliente, servidor e extratores.
 * Segue estritamente o contrato da Quick Filler especificado no README.md.
 */

export type DocumentType = 'cartao-ponto' | 'holerite';

export type TranscriptionStatus = 'processando' | 'concluido' | 'erro';

// ==========================================
// CARTÃO DE PONTO
// ==========================================

export type PunchKind = 'IN' | 'OUT';

export interface Punch {
  kind: PunchKind;
  time_raw: string;
  time_hhmm: string;
}

export interface TimeCardDay {
  date_raw: string;
  punches: Punch[];
}

export interface TimeCardPage {
  page: number;
  days: TimeCardDay[];
}

export interface TimeCardValue {
  pages: TimeCardPage[];
}

// ==========================================
// HOLERITE
// ==========================================

export interface PayrollField {
  code: string;
  label: string;
  reference: string;
  value: string;
  subFolha?: string;
}

export interface PayrollBase {
  label: string;
  value: string;
}

export interface PayrollPage {
  page: number;
  year: string;
  month: string;
  fields: PayrollField[];
  bases: PayrollBase[];
}

export interface PayrollValue {
  pages: PayrollPage[];
}

// ==========================================
// API & STORAGE RECORDS
// ==========================================

export type TranscriptionValue = TimeCardValue | PayrollValue;

export interface TranscriptionRecord {
  id: string;
  tipo: DocumentType;
  status: TranscriptionStatus;
  erro: string | null;
  value: TranscriptionValue | null;
  createdAt: string;
  fileName?: string;
  filePath?: string;
}

// ==========================================
// AVISOS E DESTAQUES
// ==========================================

export type WarningColor = 'none' | 'yellow' | 'red';

export interface WarningHighlight {
  color: WarningColor;
  reasons: string[];
  hasLeftBorder: boolean; // Borda esquerda #DC3545 na primeira célula para alertas vermelhos
}
