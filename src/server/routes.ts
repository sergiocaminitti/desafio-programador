import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { DocumentType } from '../shared/types.js';
import { validateTranscriptionValue } from '../shared/validator.js';
import { storage } from './storage.js';
import { processPdfAsync } from './job-runner.js';
import { generateExcel } from '../exporters/excel-exporter.js';
import { generateCsv } from '../exporters/csv-exporter.js';
import { generateJson } from '../exporters/json-exporter.js';

const upload = multer({
  limits: {
    fileSize: 25 * 1024 * 1024, // Limite seguro de 25MB
  },
  fileFilter: (_req, file, cb) => {
    // Validação de extensão e mimetype
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos no formato PDF são aceitos.'));
    }
  },
});

export const router = Router();

/**
 * POST /api/transcricoes
 * Recebe arquivo PDF + tipo (cartao-ponto ou holerite)
 * Retorna 202 Accepted com { id }
 */
router.post('/api/transcricoes', upload.single('arquivo'), async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    const tipo = req.body.tipo as DocumentType;

    if (!file) {
      res.status(400).json({ erro: 'Nenhum arquivo PDF foi enviado no campo "arquivo".' });
      return;
    }

    if (tipo !== 'cartao-ponto' && tipo !== 'holerite') {
      res.status(400).json({ erro: 'Campo "tipo" inválido. Deve ser "cartao-ponto" ou "holerite".' });
      return;
    }

    // Validação dos Magic Bytes (%PDF-)
    const buffer = file.buffer;
    if (buffer.length < 4 || buffer.subarray(0, 4).toString() !== '%PDF') {
      res.status(400).json({ erro: 'O arquivo enviado não é um PDF válido (cabeçalho %PDF ausente).' });
      return;
    }

    // Gera ID único alfanumérico enxuto
    const id = crypto.randomBytes(4).toString('hex');

    // Cria registro na persistência
    storage.create(id, tipo, file.originalname, buffer);

    // Dispara processamento assíncrono
    processPdfAsync(id, tipo, buffer);

    res.status(202).json({ id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno no upload';
    res.status(500).json({ erro: message });
  }
});

/**
 * GET /api/transcricoes/:id
 * Retorna status e dados da transcrição
 */
router.get('/api/transcricoes/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const record = storage.get(id);

  if (!record) {
    res.status(404).json({ erro: 'Transcrição não encontrada.' });
    return;
  }

  res.status(200).json({
    id: record.id,
    tipo: record.tipo,
    status: record.status,
    erro: record.erro,
    value: record.value,
  });
});

/**
 * PUT /api/transcricoes/:id
 * Atualiza os valores da transcrição com edições do usuário
 */
router.put('/api/transcricoes/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const record = storage.get(id);

  if (!record) {
    res.status(404).json({ erro: 'Transcrição não encontrada.' });
    return;
  }

  const newValue = req.body?.value;
  if (!newValue) {
    res.status(400).json({ erro: 'Corpo da requisição deve conter o objeto "value".' });
    return;
  }

  const validation = validateTranscriptionValue(record.tipo, newValue);
  if (!validation.success) {
    res.status(400).json({
      erro: 'Estrutura JSON inválida para este tipo de documento.',
      detalhes: validation.error.format(),
    });
    return;
  }

  storage.update(id, { value: validation.data });
  res.status(200).json({ status: 'ok', id, value: validation.data });
});

/**
 * GET /api/transcricoes/:id/planilha
 * Exporta a planilha nos formatos xlsx, csv ou json
 */
router.get('/api/transcricoes/:id/planilha', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const formato = (req.query.formato as string || 'xlsx').toLowerCase();
  const record = storage.get(id);

  if (!record) {
    res.status(404).json({ erro: 'Transcrição não encontrada.' });
    return;
  }

  if (record.status !== 'concluido' || !record.value) {
    res.status(400).json({ erro: 'A transcrição ainda não foi concluída ou falhou.' });
    return;
  }

  try {
    if (formato === 'xlsx') {
      const excelBuffer = await generateExcel(record.tipo, record.value);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="transcricao-${record.tipo}-${id}.xlsx"`);
      res.send(excelBuffer);
    } else if (formato === 'csv') {
      const csvString = generateCsv(record.tipo, record.value);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="transcricao-${record.tipo}-${id}.csv"`);
      res.send(csvString);
    } else if (formato === 'json') {
      const jsonString = generateJson(record.value);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="transcricao-${record.tipo}-${id}.json"`);
      res.send(jsonString);
    } else {
      res.status(400).json({ erro: 'Formato inválido. Use xlsx, csv ou json.' });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar exportação';
    res.status(500).json({ erro: message });
  }
});

/**
 * GET /api/transcricoes/:id/pdf
 * Serve o PDF original para o visualizador integrado
 */
router.get('/api/transcricoes/:id/pdf', (req: Request, res: Response): void => {
  const { id } = req.params;
  const pdfBuffer = storage.getPdf(id);

  if (!pdfBuffer) {
    res.status(404).json({ erro: 'Arquivo PDF não encontrado.' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="documento-${id}.pdf"`);
  res.send(pdfBuffer);
});

/**
 * GET /healthz
 * Health check da aplicação
 */
router.get('/healthz', (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
