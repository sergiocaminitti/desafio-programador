# Documentos de exemplo

PDFs para você desenvolver e testar. Todos são documentos reais com os dados
pessoais substituídos.

```
exemplos/
├── time-card-01.pdf
├── time-card-02.pdf
├── time-card-03.pdf
├── time-card-04.pdf
├── payroll-01.pdf
├── payroll-02.pdf
├── payroll-03.pdf
└── payroll-04.pdf
```

## Importante

**Nem todos têm camada de texto.** Parte destes arquivos é imagem escaneada, e
extrair o texto embutido devolve vazio neles. Sua solução precisa reconhecer o
caso e passar por OCR — ver o `README.md` na raiz.

Além disso, estes são os documentos que você **vê**, não a especificação. Uma
data, um nome de coluna, uma posição fixa na página ou um número de páginas
gravado no código resolve o exemplo e quebra em qualquer outro layout. Trate-os
como amostra.
