import fs from 'fs';
import path from 'path';
import {
  DocumentType,
  TranscriptionRecord,
  TranscriptionStatus,
  TranscriptionValue,
} from '../shared/types.js';

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), '.storage');
const MAX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 horas de retenção

// Garante que o diretório de armazenamento existe
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

class MemoryStorage {
  private records = new Map<string, TranscriptionRecord>();
  private pdfBuffers = new Map<string, Buffer>();

  constructor() {
    // Roda limpeza periódica de retenção de arquivos a cada 1 hora
    setInterval(() => {
      this.cleanupExpiredRecords();
    }, 60 * 60 * 1000);
  }

  create(id: string, tipo: DocumentType, fileName: string, pdfBuffer: Buffer): TranscriptionRecord {
    const record: TranscriptionRecord = {
      id,
      tipo,
      status: 'processando',
      erro: null,
      value: null,
      createdAt: new Date().toISOString(),
      fileName,
    };

    this.records.set(id, record);
    this.pdfBuffers.set(id, pdfBuffer);

    return record;
  }

  get(id: string): TranscriptionRecord | null {
    return this.records.get(id) || null;
  }

  getPdf(id: string): Buffer | null {
    return this.pdfBuffers.get(id) || null;
  }

  update(
    id: string,
    updates: {
      status?: TranscriptionStatus;
      erro?: string | null;
      value?: TranscriptionValue | null;
    }
  ): TranscriptionRecord | null {
    const record = this.records.get(id);
    if (!record) return null;

    if (updates.status !== undefined) record.status = updates.status;
    if (updates.erro !== undefined) record.erro = updates.erro;
    if (updates.value !== undefined) record.value = updates.value;

    return record;
  }

  delete(id: string): boolean {
    this.pdfBuffers.delete(id);
    return this.records.delete(id);
  }

  /**
   * Política explícita de retenção: remove arquivos e transcrições com mais de 24 horas.
   */
  cleanupExpiredRecords(): void {
    const now = Date.now();
    for (const [id, record] of this.records.entries()) {
      const created = new Date(record.createdAt).getTime();
      if (now - created > MAX_RETENTION_MS) {
        this.delete(id);
      }
    }
  }
}

export const storage = new MemoryStorage();
