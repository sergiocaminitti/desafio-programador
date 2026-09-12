import React, { useState, useRef } from 'react';
import { Upload, Clock, DollarSign, Loader2 } from 'lucide-react';
import { DocumentType } from '@shared/types';

interface UploadSectionProps {
  tipo: DocumentType;
  onTipoChange: (tipo: DocumentType) => void;
  onUploadStart: () => void;
  onUploadSuccess: (id: string, tipo: DocumentType, fileName: string) => void;
  onUploadError: (err: string) => void;
  isProcessing: boolean;
}

export const UploadSection: React.FC<UploadSectionProps> = ({
  tipo,
  onTipoChange,
  onUploadStart,
  onUploadSuccess,
  onUploadError,
  isProcessing,
}) => {
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      onUploadError('Por favor, selecione um arquivo no formato PDF.');
      return;
    }

    onUploadStart();

    const formData = new FormData();
    formData.append('arquivo', file);
    formData.append('tipo', tipo);

    try {
      const response = await fetch('/api/transcricoes', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.erro || `Erro HTTP ${response.status}`);
      }

      const data = (await response.json()) as { id: string; fileName?: string };
      onUploadSuccess(data.id, tipo, data.fileName || file.name);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar arquivo';
      onUploadError(message);
    }
  };

  return (
    <div className="apple-card">
      <div className="upload-card-content">
        {/* Segmented Control de Tipo de Documento */}
        <div className="segmented-control-container">
          <span className="segmented-label">Tipo de Documento</span>
          <div className="apple-segmented-control" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tipo === 'cartao-ponto'}
              className={`segmented-btn ${tipo === 'cartao-ponto' ? 'active' : ''}`}
              onClick={() => onTipoChange('cartao-ponto')}
              disabled={isProcessing}
            >
              <Clock size={15} />
              Cartão de Ponto
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tipo === 'holerite'}
              className={`segmented-btn ${tipo === 'holerite' ? 'active' : ''}`}
              onClick={() => onTipoChange('holerite')}
              disabled={isProcessing}
            >
              <DollarSign size={15} />
              Holerite
            </button>
          </div>
        </div>

        {/* Apple Dropzone */}
        <div>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="application/pdf,.pdf"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (e.target.files?.[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />

          <div
            className={`apple-dropzone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer.files?.[0]) {
                handleFileSelect(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => {
              if (!isProcessing) {
                fileInputRef.current?.click();
              }
            }}
          >
            {isProcessing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--apple-blue)' }}>
                <Loader2 size={22} className="spinner" />
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                  Analisando documento e aplicando OCR... Aguarde.
                </span>
              </div>
            ) : (
              <>
                <div className="dropzone-icon-circle">
                  <Upload size={20} />
                </div>
                <div style={{ fontSize: '0.925rem', fontWeight: 600, color: 'var(--apple-text-primary)' }}>
                  Arraste o PDF aqui ou clique para selecionar
                </div>
                <div style={{ fontSize: '0.775rem', color: 'var(--apple-text-secondary)' }}>
                  Suporta PDFs digitais e escaneados com OCR automático (até 25MB)
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
