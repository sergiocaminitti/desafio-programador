import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createApp } from '../src/server/app.js';
import { storage } from '../src/server/storage.js';
import { TimeCardValue } from '../src/shared/types.js';

describe('HTTP API Endpoints', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /healthz deve retornar 200 OK', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('PUT e GET /api/transcricoes/:id deve atualizar e recuperar transcrição', async () => {
    const testId = 'test1234';
    const fakeBuffer = Buffer.from('%PDF-1.4 Fake PDF Content');
    storage.create(testId, 'cartao-ponto', 'test.pdf', fakeBuffer);

    const initialTimeCard: TimeCardValue = {
      pages: [
        {
          page: 1,
          days: [{ date_raw: '01/01/2020', punches: [] }],
        },
      ],
    };

    storage.update(testId, { status: 'concluido', value: initialTimeCard });

    // 1. GET
    const getRes = await fetch(`${baseUrl}/api/transcricoes/${testId}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(testId);
    expect(getData.status).toBe('concluido');

    // 2. PUT
    const updatedTimeCard: TimeCardValue = {
      pages: [
        {
          page: 1,
          days: [
            {
              date_raw: '01/01/2020',
              punches: [
                { kind: 'IN', time_raw: '08:00', time_hhmm: '08:00' },
                { kind: 'OUT', time_raw: '17:00', time_hhmm: '17:00' },
              ],
            },
          ],
        },
      ],
    };

    const putRes = await fetch(`${baseUrl}/api/transcricoes/${testId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: updatedTimeCard }),
    });

    expect(putRes.status).toBe(200);
    const putData = await putRes.json();
    expect(putData.status).toBe('ok');

    // 3. GET /planilha?formato=xlsx
    const xlsxRes = await fetch(`${baseUrl}/api/transcricoes/${testId}/planilha?formato=xlsx`);
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers.get('content-type')).toContain('spreadsheetml');
  });
});
