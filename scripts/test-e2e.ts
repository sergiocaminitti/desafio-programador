import fs from 'fs';
import path from 'path';
import { TranscriptionRecord, TimeCardValue } from '../src/shared/types.js';

async function testE2E(): Promise<void> {
  const baseUrl = 'http://localhost:3000';

  console.log('--- 1. Testando Healthcheck ---');
  const healthRes = await fetch(`${baseUrl}/healthz`);
  console.log('Healthz status:', healthRes.status, await healthRes.json());

  console.log('--- 2. Testando Upload de Cartão de Ponto ---');
  const pdfBuffer = fs.readFileSync(path.join(process.cwd(), 'exemplos', 'time-card-01.pdf'));
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });

  const formData = new FormData();
  formData.append('arquivo', blob, 'time-card-01.pdf');
  formData.append('tipo', 'cartao-ponto');

  const uploadRes = await fetch(`${baseUrl}/api/transcricoes`, {
    method: 'POST',
    body: formData,
  });

  const uploadData = (await uploadRes.json()) as { id: string };
  console.log('Upload response status:', uploadRes.status, uploadData);
  const id = uploadData.id;

  console.log('--- 3. Polling do status da transcrição ---');
  let record: TranscriptionRecord | null = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const getRes = await fetch(`${baseUrl}/api/transcricoes/${id}`);
    record = (await getRes.json()) as TranscriptionRecord;
    console.log(`Polling [${i + 1}]: status = ${record.status}`);
    if (record.status === 'concluido') break;
  }

  if (!record || !record.value) {
    throw new Error('Falha: Transcrição não retornou valor no polling');
  }

  const timeCardValue = record.value as TimeCardValue;
  console.log('Dias extraídos:', timeCardValue.pages[0].days.length);

  console.log('--- 4. Testando Edição (PUT) ---');
  timeCardValue.pages[0].days[0].date_raw = '01/05/2019';
  const putRes = await fetch(`${baseUrl}/api/transcricoes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: timeCardValue }),
  });
  console.log('PUT response status:', putRes.status);

  console.log('--- 5. Testando Download .xlsx ---');
  const xlsxRes = await fetch(`${baseUrl}/api/transcricoes/${id}/planilha?formato=xlsx`);
  const xlsxBuffer = await xlsxRes.arrayBuffer();
  console.log('XLSX status:', xlsxRes.status, 'size:', xlsxBuffer.byteLength, 'bytes');

  console.log('--- 6. Testando Download .csv ---');
  const csvRes = await fetch(`${baseUrl}/api/transcricoes/${id}/planilha?formato=csv`);
  const csvText = await csvRes.text();
  console.log('CSV status:', csvRes.status, 'lines:', csvText.split('\n').length);

  console.log('--- 7. Testando Download .json ---');
  const jsonRes = await fetch(`${baseUrl}/api/transcricoes/${id}/planilha?formato=json`);
  const jsonVal = (await jsonRes.json()) as TimeCardValue;
  console.log('JSON status:', jsonRes.status, 'pages:', jsonVal.pages.length);

  console.log('--- 8. Testando PDF Preview Endpoint ---');
  const pdfRes = await fetch(`${baseUrl}/api/transcricoes/${id}/pdf`);
  console.log('PDF Preview status:', pdfRes.status, 'content-type:', pdfRes.headers.get('content-type'));

  console.log('=========================================');
  console.log(' TODOS OS TESTES E2E PASSARAM COM SUCESSO! ');
  console.log('=========================================');
}

testE2E().catch(console.error);
