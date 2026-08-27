# SOLUÇÃO TÉCNICA — Desafio Programador Quick Filler

Esta documentação descreve a arquitetura, decisões de engenharia, instruções de execução, medidas de segurança e detalhes de entrega da solução desenvolvida para o desafio técnico da **Quick Filler**.

A aplicação entrega o ciclo completo de transcrição, auditoria e revisão interativa de **Cartões de Ponto** e **Holerites** em PDF, gerando saídas estruturadas em **`.xlsx`**, **`.csv`** e **`.json`**, em conformidade com as especificações do desafio.

---

## 1. Entregáveis do Projeto

Conforme solicitado no `README.md` e `INSTRUCOES.md`, aqui estão os 5 entregáveis do desafio:

1. **Repositório Git:** [https://github.com/sergiocaminitti/desafio-programador](https://github.com/sergiocaminitti/desafio-programador)
2. **URL da Aplicação Publicada (Render):** [https://desafio-programador-8lr6.onrender.com/](https://desafio-programador-8lr6.onrender.com/)
3. **`SOLUCAO.md`:** Este documento técnico (arquitetura, operação, segurança e decisões).
4. **`PROCESSO.md`:** Relatório detalhado sobre condução com IA, correções manuais e respostas reflexivas.
5. **Planilhas Geradas em `exemplos/`:** Todas as 12 planilhas resultantes dos 4 PDFs de teste (`.xlsx`, `.csv` e `.json`) geradas e versionadas no repositório.

---

## 2. Arquitetura e Decisões de Engenharia

O sistema segue o princípio fundamental estabelecido nas especificações: **um único pipeline, dois extratores especializados**.

```text
[Upload PDF (≤25MB)]
        │
        ▼
[Validação Magic Bytes (%PDF-) & Fila Assíncrona (202 Accepted)]
        │
        ▼
[Extrator Híbrido: Leitura Espacial (Y-Clustering) / OCR Tesseract PT]
        │
        ▼
[Armazenamento em Memória & Retenção Ativa de 24h]
        │
        ▼
[Interface Web Split-View (Revisão, Auditoria em Tempo Real & Auto-Save)]
        │
        ▼
[Exportadores Formatados: Excel (.xlsx), CSV (UTF-8 BOM) e JSON]
```

### 2.1. Fullstack TypeScript Unificado
* **Stack:** Node.js 22 + Express + React + Vite + ExcelJS + Tesseract.js + Zod + Vitest.
* **Motivação:** A unificação em TypeScript permitiu compartilhar diretamente os modelos de domínio (`src/shared/types.ts`) e o motor de regras de auditoria (`src/shared/warnings.ts`) entre o frontend e o backend. As mesmas regras que pintam as linhas de amarelo e vermelho na tabela do navegador são executadas pelo backend na estilização das planilhas Excel, eliminando duplicação de lógica e divergências de formato.

### 2.2. Processamento Assíncrono Não Bloqueante (`202 Accepted`)
* A rota `POST /api/transcricoes` valida os magic bytes do arquivo, registra o job e retorna imediatamente `202 Accepted` com `{ "id": "..." }`.
* O processamento é delegado ao `job-runner.ts` em background. O frontend realiza polling em `GET /api/transcricoes/:id`, garantindo que requisições HTTP nunca sofram timeout, mesmo ao processar PDFs pesados ou que demandem OCR.

### 2.3. Estratégia Híbrida de Extração (Camada Nativa + Fallback de OCR)
* **PDFs Digitais com Camada de Texto:** Processados com precisão espacial via `pdfjs-dist`. Um algoritmo de **$Y$-clustering** com tolerância vertical de $\pm 4.0\text{pt}$ agrupa os tokens em linhas e os ordena horizontalmente no eixo $X$.
* **PDFs Escaneados / Imagens:** O leitor analisa a densidade de texto da página. Se houver menos de 25 caracteres legíveis, o motor aciona automaticamente o fallback do **Tesseract.js** (com dicionário em português) para reconhecimento óptico de caracteres.

### 2.4. Honestidade dos Dados e Incerteza Controlada
* Caracteres ilegíveis ou com baixa confiança de leitura recebem o caractere `?` na posição exata (ex: `"0?:25"` para horários ou `"2.3?9,77"` para valores monetários).
* O extrator **nunca chuta valores** nem inventa dígitos. Validações estritas rejeitam horários impossíveis (como `"25:00"`) e datas inexistentes no calendário (como `"31/02/2020"`).

### 2.5. Separação Estrita de `fields` vs `bases` no Holerite
* **Verbas contratuais (`fields`):** Apenas proventos e descontos (ex: `0010 Salário Base`, `5560 Horas Extras`, `0998 INSS`) entram em `fields`, gerando as colunas transpostas da planilha.
* **Bases e Totais (`bases`):** Totais como `Base INSS`, `Base FGTS`, `Total Vencimentos`, `Total Descontos` e `Valor Líquido` são isolados na seção de bases, evitando a contaminação da matriz principal.
* **Valores Monetários como String:** Todos os valores numéricos de dinheiro são preservados estritamente como string no padrão brasileiro (ex: `"2.389,77"`), sem conversão para ponto flutuante.

---

## 3. Como Executar

### 3.1. Via Docker Compose (Recomendado)

O projeto conta com `Dockerfile` multi-stage otimizado com `node:22-slim` e as dependências do Tesseract OCR:

```bash
# Subir a aplicação completa (frontend + backend na porta 3000)
docker compose up --build
```

Acesse no navegador: **`http://localhost:3000`**

### 3.2. Localmente com Node.js (>= 22)

```bash
# 1. Instalar dependências
npm install

# 2. Executar em modo desenvolvimento (com Vite HMR e Live Reload)
npm run dev

# 3. Compilar e executar a versão de produção
npm run build
npm start
```

### 3.3. Execução dos Testes Automatizados

A suíte conta com 18 testes unitários e de integração cobrindo os cenários críticos:

```bash
npm run test
```

---

## 4. Segurança, Privacidade e Política de Retenção

1. **Validação de Entrada e Uploads:**
   * Limite de tamanho de arquivo de **25 MB**.
   * Validação obrigatória de **Magic Bytes** no buffer (`%PDF-` nos 4 primeiros bytes), impedindo que arquivos executáveis ou maliciosos renomeados como `.pdf` sejam processados.
2. **Política de Retenção de 24 Horas:**
   * PDFs e dados transcritos são armazenados temporariamente na memória e no diretório `.storage/`.
   * Um coletor automático ativo (`storage.ts`) executa limpezas periódicas e **expurga definitivamente qualquer arquivo ou registro com mais de 24 horas** de criação (`MAX_RETENTION_MS = 86.400.000 ms`).
3. **Privacidade (Zero PII nos Logs):**
   * O middleware de logging do Express foi desenvolvido sob política estrita de não vazamento de dados pessoais (PII). Os logs registram exclusivamente metadados técnicos:
     `[HTTP] GET /api/transcricoes/c718009e 200 - 1ms`
   * Nomes de funcionários, salários, cargos ou documentos nunca são impressos no console do servidor.

---

## 5. O que Ficou de Fora (Melhorias Futuras)

Para entregar um protótipo confiável e de alta qualidade dentro do orçamento proposto de ~14 horas, delimitamos o escopo deixando os seguintes pontos para uma versão corporativa:

1. **Autenticação e Controle de Acesso (RBAC):** Login com JWT / OAuth2 e segregação de documentos por empresa/usuário.
2. **Pré-processamento de Imagens Avançado para OCR:** Inclusão de biblioteca de visão computacional (ex: OpenCV / Sharp) para deskewing (correção de rotação de fotos tortas), aumento de contraste e binarização adaptativa antes de submeter ao OCR.
3. **Persistência em Nuvem Distribuída:** Armazenamento dos PDFs originais em buckets S3/GCS com URLs assinadas e persistência em banco relacional PostgreSQL com fila Redis/BullMQ para cenários de alta concorrência.
