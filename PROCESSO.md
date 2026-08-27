# PROCESSO — Relatório de Condução do Projeto com IA e Decisões Técnicas

Este documento detalha o processo de engenharia, a colaboração com ferramentas de Inteligência Artificial, as correções manuais realizadas e a análise crítica das decisões tomadas durante o desenvolvimento do desafio da **Quick Filler**.

---

## 1. Ferramentas Utilizadas e Propósito

* **Antigravity IDE / Assistente Gemini:** Par de programação (pair programming), estruturação da arquitetura em camadas, geração de código TypeScript, implementação das heurísticas de layout, criação da suíte de testes e suporte na depuração.
* **Node.js 22 + TypeScript + Express:** Construção da API HTTP, controle da fila assíncrona de transcrições, validação de esquemas Zod e política ativa de retenção de 24 horas.
* **Vite + React (TypeScript):** Desenvolvimento da interface de revisão interativa em Split-View inspirada nas diretrizes do *Apple Human Interface Guidelines (HIG)*.
* **Tesseract.js / Tesseract OCR (Linux):** Engine de reconhecimento óptico de caracteres com dicionário em português para documentos escaneados.
* **ExcelJS:** Geração programática de planilhas `.xlsx` com cabeçalho corporativo azul marinho (`#173772`), texto branco em negrito e realces condicionais de auditoria (`#FFF3CD` e `#F8D7DA`).
* **Vitest:** Executor da suíte com 18 testes automatizados cobrindo os cenários de maior risco do domínio.
* **Docker & Docker Compose:** Containerização multi-stage para execução local imediata e deploy no Render.com.

---

## 2. A Condução do Projeto: Da Concepção à Entrega

Nossa condução foi estruturada em 6 etapas pragmáticas, mantendo o foco no orçamento de tempo (~14h) e no rigor da especificação:

### Etapa 1: Definição da Stack Técnica
Inicialmente, avaliei usar Ruby on Rails e React (onde possuo maior familiaridade). No entanto, discutindo a arquitetura com o assistente do Antigravity, concluímos que adotar **Fullstack TypeScript unificado** traria uma vantagem competitiva decisiva: poder compartilhar os tipos do contrato (`types.ts`) e, principalmente, a **mesma lógica de auditoria (`warnings.ts`)** entre a tabela interativa do navegador e o exportador de planilhas do backend, eliminando o custo de manter duas linguagens diferentes em um prazo curto.

### Etapa 2: Planejamento Arquitetural (`implementation_plan.md`)
Antes de escrever código, elaboramos um plano de implementação abrangente. Mapeamos os contratos da API (`202 Accepted` assíncrono), a estrutura de pastas, os algoritmos de leitura de PDF e os formatos esperados de saída.

### Etapa 3: Primeira Passada e Validação Local
O agente gerou a primeira versão do código base e subimos o servidor local. A aplicação carregou com sucesso, mas apresentava inconsistências de tipagem, avisos de linter e uma interface ainda rudimentar.

### Etapa 4: Refinamento e Limpeza de Diagnósticos
Realizamos uma varredura para elevar o padrão da base de código:
* Configuramos os aliases de `@shared/*` no `tsconfig.json`.
* Tipamos explicitamente todos os parâmetros e callbacks, eliminando `any` implícitos.
* Removemos imports e variáveis não utilizadas, atingindo **zero erros e zero warnings** no `tsc --noEmit`.

### Etapa 5: Testes com PDFs Reais e Redesign
Com os arquivos de `exemplos/` no ambiente, testamos a extração real e identificamos melhorias de usabilidade:
* Criamos o workspace em **Split-View** (PDF original à esquerda e grade editável à direita).
* Implementamos **salvamento automático (Auto-save)** com debounce de 600ms após qualquer edição do usuário, além de manter o botão manual.
* Adicionamos máscaras e filtros rígidos para valores monetários e datas.
* Corrigimos bugs de layout e estabilidade das tabelas.

### Etapa 6: Deploy em Nuvem e Versionamento Modular
* Estruturamos o histórico do Git em **10 commits modulares e semânticos** (*Conventional Commits*), demonstrando a evolução arquitetural do projeto.
* Publicamos a aplicação no **Render.com** utilizando o `Dockerfile` multi-stage, garantindo o funcionamento do runtime Node 22 e do Tesseract OCR em produção.

---

## 3. Onde o Agente Errou ou Pegou o Caminho Errado (e Como Corrigimos)

Durante o desenvolvimento, a IA gerou algumas abordagens inadequadas que foram identificadas e corrigidas na revisão:

1. **Bug da Coluna que Sumia no Holerite:**
   * *O Problema:* Ao editar a tabela de holerite, se o usuário apagasse o valor de uma célula (`newVal === ''`), o código executava um `splice` removendo a verba do array da página. Como a lista de colunas da tabela era derivada dinamicamente das verbas existentes, apagar uma célula fazia a coluna inteira desaparecer do cabeçalho da tela.
   * *A Correção:* Alteramos a lógica para manter o campo no array com `value: ''` (como uma célula em branco no Excel), garantindo que a matriz de colunas permaneça estável e fixa.
2. **Rolagem Silenciosa de Datas Impossíveis no JavaScript:**
   * *O Problema:* A IA usou `new Date(year, month - 1, day)` para validar datas. Em JavaScript nativo, datas inválidas como `31/02/2020` sofrem rolagem automática para o mês seguinte (`02/03/2020`) sem acusar erro.
   * *A Correção:* Reescrevemos a função `parseDateString` com validação estrita no calendário real (`d.getDate() === day && d.getMonth() === month - 1`). Agora, qualquer data impossível (como `31/02` ou `32/05`) é imediatamente sinalizada com alerta de auditoria amarelo.
3. **Falta de Restrição em Campos de Salário/Moeda:**
   * *O Problema:* Inicialmente, o usuário conseguia digitar letras (`abc`) e caracteres aleatórios nos campos de valor de verbas.
   * *A Correção:* Implementamos uma máscara em tempo real (`replace(/[^\d\.,\?]/g, '')`) nos inputs e adicionamos a validação `isValidBrazilianCurrency` no motor de regras, preservando o valor estritamente como string no formato brasileiro.
4. **Exibição de Códigos Hexadecimais na Interface:**
   * *O Problema:* A IA gerou a legenda de auditoria exibindo `#FFF3CD` e `#F8D7DA` diretamente para o usuário final.
   * *A Correção:* Substituímos os códigos técnicos por rótulos humanos e didáticos: *"Atenção (Amarelo): Batidas ímpares, caractere ilegível (?) ou página vazia"* e *"Crítico (Vermelho): Data ou mês fora da sequência esperada"*.
5. **Express Servindo Build Estático em Modo de Desenvolvimento:**
   * *O Problema:* O Express estava configurado para servir a pasta `dist/client` compilada mesmo em modo `dev`, o que impedia que alterações de texto e componentes no React refletissem no navegador ao rodar `npm run dev`.
   * *A Correção:* Conectamos o middleware do Vite (`vite.middlewares`) diretamente no Express em desenvolvimento, habilitando Hot Module Replacement (HMR) instantâneo.

---

## 4. O que Reescrevemos ou Ajustamos Diretamente

* **Lógica de Precedência de Alertas:** Garantimos matematicamente que qualquer quebra de sequência temporal (vermelho com borda `#DC3545`) sobreponha alertas de batida ímpar ou incerteza (amarelo), e que a transição de Dezembro $\rightarrow$ Janeiro seja tratada como consecutiva.
* **Heurística de Agrupamento Espacial ($Y$-Clustering):** Calibramos a tolerância vertical para $\pm 4.0\text{pt}$ e o espaçamento horizontal para que horários colados não fossem agrupados como uma única palavra.
* **Proporções do Workspace e Tipografia:** Ajustamos a coluna do PDF para 420px fixos e expandimos a tabela de revisão para ocupar todo o restante do monitor, utilizando a fonte `SF Mono` para alinhamento numérico perfeito.

---

## 5. Respostas às Perguntas Reflexivas

### 1. Cite 3 decisões em que havia mais de uma resposta razoável. Por que escolheu essa?

1. **Gatilho de OCR por Densidade de Caracteres (< 25) vs. OCR em Todas as Páginas:**
   * *Alternativa:* Rodar OCR em todos os PDFs indistintamente ou tentar extrair apenas texto nativo.
   * *Decisão:* Analisar a quantidade de caracteres da página via `pdfjs-dist`; se for menor que 25, acionar o Tesseract.
   * *Justificativa:* Rodar OCR em PDFs que já possuem texto nativo aumentaria o tempo de processamento de ~100ms para vários segundos desnecessariamente. A abordagem híbrida garante velocidade máxima em PDFs digitais e precisão automática em escaneados.
2. **Agrupamento Espacial Heurístico ($Y$-Clustering) vs. Coordenadas $(X, Y)$ Absolutas Fixas:**
   * *Alternativa:* Mapear caixas delimitadoras com coordenadas fixas para cada modelo de PDF.
   * *Decisão:* Agrupamento dinâmico por proximidade vertical ($\pm 4\text{pt}$) e ordenação horizontal no eixo $X$.
   * *Justificativa:* Coordenadas absolutas quebram com variações mínimas de margem, DPI ou cabeçalho. A heurística espacial torna o extrator resiliente a layouts desconhecidos.
3. **Endpoint Auxiliar `/api/transcricoes/:id/pdf` em `<iframe>` Nativo vs. Renderizador Canvas no React (`react-pdf`):**
   * *Alternativa:* Renderizar cada página do PDF em elementos `<canvas>` gerenciados pelo estado do React.
   * *Decisão:* Servir o stream do buffer via rota interna `/pdf` em um `<iframe>` nativo do navegador.
   * *Justificativa:* O visualizador embutido do navegador é mais leve, performático, já inclui zoom, rotação e busca textual, e não sofre com vazamento de memória de canvas nem depende de serviços externos de cloud storage (como AWS S3).
4. **Armazenamento em Memória com Expurgo de 24h vs. Banco Relacional / Redis:**
   * *Alternativa:* Subir PostgreSQL e Redis com BullMQ no Docker Compose.
   * *Decisão:* Armazenamento em memória com limpeza periódica automática.
   * *Justificativa:* Elimina dependências externas pesadas que poderiam falhar no ambiente do avaliador ou no deploy gratuito, atendendo com perfeição ao ciclo de vida de uma sessão de transcrição com zero atrito operacional.

---

### 2. O que na sua solução quebra primeiro em produção?

* **Holerites em Múltiplas Colunas Paralelas (Fichas Financeiras Complexas):**
  * O extrator de holerite assume que as verbas seguem uma leitura linear por página. Em documentos onde proventos e descontos estão dispostos em blocos lado a lado na mesma linha horizontal sem códigos numéricos bem definidos, o agrupamento por linha ($Y$-clustering) pode agrupar o provento e o desconto na mesma linha da tabela, demandando revisão manual do usuário na interface ou um modelo avançado de segmentação por blocos visuais.
* **Documentos Escaneados com Rotação Inclinada (Skewed) ou Ruído Excessivo:**
  * Fotos de celular tiradas em ângulo inclinado, com sombras ou resolução muito baixa (< 150 DPI) degradam a acurácia do OCR Tesseract sem uma etapa de pré-processamento de imagem.
* **Concorrência sob Carga Massiva de OCR:**
  * Múltiplos uploads simultâneos de PDFs pesados demandando OCR podem elevar o uso de CPU/RAM, exigindo uma fila distribuída com worker nodes dedicados em produção de grande porte.

---

### 3. Onde você não confia no que entregou?

* **Acurácia de OCR em Documentos Altamente Degradados:**
  * Embora o OCR com Tesseract funcione bem para PDFs escaneados retos e legíveis, não implementamos uma biblioteca de visão computacional (como OpenCV) para fazer deskewing (desentortar páginas) ou binarização adaptativa. Por isso, a confiabilidade da nossa solução repousa na **honestidade dos dados**: o sistema marca qualquer incerteza com `?` e alerta o usuário com destaque amarelo na interface para que ele valide antes de exportar.
* **Segurança de Endpoints sem Autenticação / RBAC:**
  * Por se tratar de um protótipo focado no desafio técnico, os endpoints da API são públicos e sem controle de sessão de usuário. Em um cenário corporativo real com dados da LGPD, seria indispensável implementar autenticação JWT, autorização baseada em funções (RBAC), criptografia em repouso e rate limiting.
