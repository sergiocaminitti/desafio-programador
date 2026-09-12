import React from 'react';
import { FileText } from 'lucide-react';

interface PdfViewerProps {
  transcriptionId: string | null;
  fileName?: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ transcriptionId, fileName }) => {
  if (!transcriptionId) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--apple-text-secondary)',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(0, 0, 0, 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--apple-text-tertiary)',
          }}
        >
          <FileText size={32} strokeWidth={1.5} />
        </div>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--apple-text-primary)', fontSize: '0.95rem' }}>
            Nenhum PDF Carregado
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', maxWidth: '280px' }}>
            Envie um Cartão de Ponto ou Holerite acima para visualizá-lo em tempo real.
          </div>
        </div>
      </div>
    );
  }

  const safeFileName = fileName || 'documento.pdf';
  const pdfUrl = `/api/transcricoes/${transcriptionId}/arquivo/${encodeURIComponent(safeFileName)}`;

  return (
    <div className="pdf-iframe-container">
      <iframe
        src={pdfUrl}
        title={fileName ? `Visualizador de ${fileName}` : 'Visualizador de PDF Original'}
        className="pdf-iframe"
      />
    </div>
  );
};
