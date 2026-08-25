import { createWorker } from 'tesseract.js';

let workerPromise: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Cria worker do Tesseract com suporte a português e inglês
      const worker = await createWorker(['por', 'eng']);
      return worker;
    })();
  }
  return workerPromise;
}

export interface OcrResultLine {
  text: string;
  confidence: number;
  x?: number;
  y?: number;
}

/**
 * Executa OCR em um buffer de imagem.
 */
export async function performOcr(imageBuffer: Buffer): Promise<string> {
  try {
    const worker = await getWorker();
    const result = await worker.recognize(imageBuffer);
    return result.data.text;
  } catch (error) {
    console.error('[OCR] Erro ao processar OCR da imagem:', error);
    return '';
  }
}
