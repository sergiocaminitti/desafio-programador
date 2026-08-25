import { DocumentType } from '../shared/types.js';
import { readPdfDocument } from '../core/pdf-reader.js';
import { extractTimeCard } from '../core/time-card-extractor.js';
import { extractPayroll } from '../core/payroll-extractor.js';
import { storage } from './storage.js';

/**
 * Executa o processamento assíncrono do PDF sem bloquear a resposta HTTP.
 */
export async function processPdfAsync(id: string, tipo: DocumentType, pdfBuffer: Buffer): Promise<void> {
  // Executa no próximo tick da fila de eventos
  setImmediate(async () => {
    try {
      console.log(`[JobRunner] Iniciando extração do PDF [${id}], tipo: ${tipo}...`);

      // 1. Extração estruturada (leitura nativa + OCR fallback se necessário)
      const doc = await readPdfDocument(pdfBuffer);

      // 2. Parser de acordo com o tipo de documento
      if (tipo === 'cartao-ponto') {
        const timeCardValue = extractTimeCard(doc);
        storage.update(id, {
          status: 'concluido',
          value: timeCardValue,
          erro: null,
        });
      } else if (tipo === 'holerite') {
        const payrollValue = extractPayroll(doc);
        storage.update(id, {
          status: 'concluido',
          value: payrollValue,
          erro: null,
        });
      } else {
        throw new Error(`Tipo de documento desconhecido: ${tipo}`);
      }

      console.log(`[JobRunner] Concluída extração com sucesso [${id}]`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Falha desconhecida no processamento do documento';
      console.error(`[JobRunner] Erro ao processar documento [${id}]:`, errorMessage);

      storage.update(id, {
        status: 'erro',
        erro: `Não foi possível processar o documento: ${errorMessage}`,
      });
    }
  });
}
