import { createWorker } from 'tesseract.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Workers por PSM mode — lazy init, um por mode para não reinicializar
const workers = new Map<string, Promise<Tesseract.Worker>>();

/**
 * Retorna (criando se necessário) um worker Tesseract configurado com o PSM indicado.
 * Reutilizamos o worker entre chamadas para a mesma PSM para evitar overhead de criação.
 */
async function getWorker(psmMode: string): Promise<Tesseract.Worker> {
  if (!workers.has(psmMode)) {
    workers.set(psmMode, (async () => {
      const worker = await createWorker('por');
      await worker.setParameters({
        tessedit_pageseg_mode: psmMode as any,
        // Preserva apenas caracteres relevantes para documentos trabalhistas
        tessedit_char_whitelist:
          '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
          'ÀàÁáÂâÃãÄäÇçÉéÊêÍíÓóÔôÕõÚúÜü/:.-_,()[]|!\u2014 \n',
      });
      return worker;
    })());
  }
  return workers.get(psmMode)!;
}

/**
 * Worker dedicado para ficha de quinzena.
 * PSM 11 (texto esparso) trata tokens individualmente — melhor para grades esparsas.
 * Sem whitelist para permitir o modelo de linguagem ajudar na segmentação.
 */
let quinzenaWorkerPromise: Promise<Tesseract.Worker> | null = null;
async function getQuinzenaWorker(): Promise<Tesseract.Worker> {
  if (!quinzenaWorkerPromise) {
    quinzenaWorkerPromise = (async () => {
      const worker = await createWorker('por');
      await worker.setParameters({
        tessedit_pageseg_mode: '11' as any, // texto esparso — melhor para grades esparsas
      });
      return worker;
    })();
  }
  return quinzenaWorkerPromise;
}

export interface OcrResultLine {
  text: string;
  confidence: number;
  x?: number;
  y?: number;
}

/** Token OCR com posição e confiança — usado para extração por coluna */
export interface OcrWord {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Pontua a qualidade de um texto OCR para escolha entre PSM modes.
 * Exportado para uso no pdf-reader.
 *
 * Critérios:
 * - Prioriza linhas longas com múltiplos tokens úteis (horários + contexto)
 * - Penaliza fragmentação (muitas linhas muito curtas = PSM 11 em docs estruturados)
 * - Valoriza linhas que contêm TANTO horários HH:MM QUANTO texto contextual
 *
 * Isso favorece PSM 6/4 em docs com linhas estruturadas (TC-02, TC-01)
 * e ainda permite PSM 11/6 ganhar em docs com texto disperso (TC-04).
 */
export function scoreOcrText(text: string): number {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  if (lines.length === 0) return 0;

  let score = 0;
  for (const line of lines) {
    const hasTime = /\d{1,2}:\d{2}/.test(line);
    const hasDate = /\d{1,2}\/\d{4}|\d{2}\/\d{2}\/\d{4}/.test(line);
    const len = line.length;

    if (hasTime && len >= 15) {
      // Linha longa com horário = linha de dados estruturada → alta pontuação
      score += 10;
    } else if (hasTime && len >= 8) {
      // Linha média com horário
      score += 5;
    } else if (hasTime) {
      // Linha curta com horário (fragmento)
      score += 2;
    } else if (hasDate) {
      score += 3;
    } else if (len >= 10) {
      score += 1;
    }
  }

  // Penaliza documentos muito fragmentados (razão linhas curtas / total)
  const shortLines = lines.filter((l) => l.length < 8).length;
  const fragmentRatio = shortLines / lines.length;
  if (fragmentRatio > 0.6) {
    score = Math.round(score * 0.5); // penalidade por fragmentação excessiva
  }

  return score;
}

/**
 * Executa OCR com um PSM mode específico.
 */
export async function performOcr(imageBuffer: Buffer, psmMode = '4'): Promise<string> {
  try {
    const worker = await getWorker(psmMode);
    const result = await worker.recognize(imageBuffer);
    return result.data.text;
  } catch (error) {
    console.error(`[OCR] Erro ao processar OCR (PSM ${psmMode}):`, error);
    return '';
  }
}

/**
 * Executa OCR tentando múltiplos PSM modes e retorna o resultado com mais
 * linhas úteis.
 *
 * PSM 4  = coluna única de largura variável  → bom para relatórios em colunas
 * PSM 6  = bloco de texto uniforme           → bom para tabelas densas
 * PSM 11 = texto esparso sem ordem           → bom para grades com células isoladas
 *
 * Usado principalmente para cartões de ponto físicos com grade de células dispersas.
 */
export async function performOcrBestOf(
  imageBuffer: Buffer,
  modes = ['6', '11', '4']
): Promise<string> {
  let bestText = '';
  let bestScore = -1;

  for (const mode of modes) {
    const text = await performOcr(imageBuffer, mode);
    const score = scoreOcrText(text);
    console.log(`[OCR] PSM ${mode}: score=${score}`);
    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

  return bestText;
}

/**
 * Pré-processa uma imagem de ficha de quinzena para binarização.
 *
 * Análise real do TC-04: a imagem tem fundo cinza-azulado (r~200,g~210,b~215)
 * e os carimbos/texto são ligeiramente mais escuros em qualquer canal.
 *
 * Passos:
 *   1. Binarização por luminância (threshold 210): captura carimbos claros e texto
 *   2. Remoção de linhas horizontais e verticais da grade (run-length >= 60px)
 *      para não confundir o OCR com traços da tabela
 */
export async function preprocessQuinzenaImage(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const img = await loadImage(imageBuffer);
    const W = img.width;
    const H = img.height;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;

    // ── Passo 1: binarização por luminância ───────────────────────────────
    const bin = new Uint8Array(W * H); // 0=preto, 1=branco
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      bin[i >> 2] = lum >= 210 ? 1 : 0; // 1=branco, 0=preto
    }

    // ── Passo 2: remove linhas horizontais longas (grade da tabela) ────────
    // Uma linha horizontal contínua de >= 60px pretos = parte da grade
    const HLINE_MIN = 60;
    for (let y = 0; y < H; y++) {
      let runStart = -1;
      let runLen = 0;
      for (let x = 0; x <= W; x++) {
        const isBlack = x < W && bin[y * W + x] === 0;
        if (isBlack) {
          if (runStart < 0) runStart = x;
          runLen++;
        } else {
          if (runLen >= HLINE_MIN) {
            // Remove a linha (torna branco)
            for (let rx = runStart; rx < runStart + runLen; rx++) {
              bin[y * W + rx] = 1;
            }
          }
          runStart = -1;
          runLen = 0;
        }
      }
    }

    // ── Passo 3: remove linhas verticais longas ────────────────────────────
    const VLINE_MIN = 60;
    for (let x = 0; x < W; x++) {
      let runStart = -1;
      let runLen = 0;
      for (let y = 0; y <= H; y++) {
        const isBlack = y < H && bin[y * W + x] === 0;
        if (isBlack) {
          if (runStart < 0) runStart = y;
          runLen++;
        } else {
          if (runLen >= VLINE_MIN) {
            for (let ry = runStart; ry < runStart + runLen; ry++) {
              bin[ry * W + x] = 1;
            }
          }
          runStart = -1;
          runLen = 0;
        }
      }
    }

    // ── Passo 4: escreve imagem binarizada sem as linhas da grade ──────────
    for (let i = 0; i < bin.length; i++) {
      const v = bin[i] ? 255 : 0;
      data[i * 4]     = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      // alpha inalterado
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toBuffer('image/png');
  } catch (err) {
    console.warn('[OCR] Falha no pré-processamento de quinzena, usando imagem original:', err);
    return imageBuffer;
  }
}

/**
 * Executa OCR de ficha de quinzena e retorna os tokens com bbox.
 *
 * Usa pré-processamento de cores (destaca carimbos vermelhos e tinta azul/preta)
 * + PSM 11 (texto esparso) + whitelist numérica para maximizar a detecção de horários.
 *
 * @returns Array de OcrWord com text, confidence e coordenadas bbox
 */
export async function performOcrQuinzenaWords(imageBuffer: Buffer): Promise<OcrWord[]> {
  try {
    const processed = await preprocessQuinzenaImage(imageBuffer);
    const worker = await getQuinzenaWorker();
    const result = await worker.recognize(processed);

    return result.data.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => ({
        text: w.text.trim(),
        confidence: w.confidence,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
      }));
  } catch (error) {
    console.error('[OCR] Erro no OCR de quinzena:', error);
    return [];
  }
}
