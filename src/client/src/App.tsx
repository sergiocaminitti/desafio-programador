import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  DocumentType,
  TranscriptionRecord,
  TimeCardValue,
  PayrollValue,
  TranscriptionValue,
  TimeCardPage,
} from '@shared/types';
import { computeTimeCardWarnings, computePayrollWarnings } from '@shared/warnings';
import { UploadSection } from './components/UploadSection';
import { PdfViewer } from './components/PdfViewer';
import { TimeCardGrid } from './components/TimeCardGrid';
import { PayrollGrid } from './components/PayrollGrid';
import { LegendBar } from './components/LegendBar';
import {
  FileSpreadsheet,
  Download,
  Save,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  Loader2,
} from 'lucide-react';

export const App: React.FC = () => {
  const [tipo, setTipo] = useState<DocumentType>('cartao-ponto');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [record, setRecord] = useState<TranscriptionRecord | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isInitialLoadRef = useRef<boolean>(true);

  // Polling para acompanhar o processamento assíncrono
  useEffect(() => {
    if (!currentId || !isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/transcricoes/${currentId}`);
        if (!res.ok) return;

        const data = (await res.json()) as TranscriptionRecord;
        setRecord(data);

        if (data.status === 'concluido') {
          setIsProcessing(false);
          isInitialLoadRef.current = true;
          clearInterval(interval);
        } else if (data.status === 'erro') {
          setIsProcessing(false);
          setErrorMessage(data.erro || 'Ocorreu um erro no processamento do documento.');
          clearInterval(interval);
        }
      } catch (e: unknown) {
        console.error('Erro no polling:', e);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentId, isProcessing]);

  // Salvamento automático com debounce (600ms) após edição do usuário
  useEffect(() => {
    if (!currentId || !record?.value || isProcessing || record.status !== 'concluido') return;

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSaveStatus('saving');
        const res = await fetch(`/api/transcricoes/${currentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: record.value }),
        });

        if (res.ok) {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } else {
          setSaveStatus('error');
        }
      } catch (err: unknown) {
        console.error('Erro no auto-save:', err);
        setSaveStatus('error');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [record?.value, currentId, isProcessing, record?.status]);

  const handleUploadStart = () => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSaveStatus('idle');
  };

  const handleUploadSuccess = (id: string, uploadedTipo: DocumentType) => {
    setCurrentId(id);
    setTipo(uploadedTipo);
    setIsProcessing(true);
  };

  const handleUploadError = (err: string) => {
    setIsProcessing(false);
    setErrorMessage(err);
  };

  const handleValueChange = (newValue: TranscriptionValue) => {
    if (!record) return;
    setRecord({
      ...record,
      value: newValue,
    });
  };

  const handleSave = async () => {
    if (!currentId || !record?.value) return;

    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/transcricoes/${currentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: record.value }),
      });

      if (!res.ok) {
        throw new Error('Falha ao salvar edições.');
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e: unknown) {
      console.error(e);
      setSaveStatus('error');
    }
  };

  const handleDownload = async (formato: 'xlsx' | 'csv' | 'json') => {
    if (!currentId) return;

    // Garante que o estado mais recente esteja salvo antes do download
    if (record?.value) {
      await fetch(`/api/transcricoes/${currentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: record.value }),
      }).catch(console.error);
    }

    window.open(`/api/transcricoes/${currentId}/planilha?formato=${formato}`, '_blank');
  };

  // Métricas dinâmicas para a barra de auditoria
  const stats = useMemo(() => {
    if (!record?.value) return { total: 0, warnings: 0 };

    if (record.tipo === 'cartao-ponto') {
      const tc = record.value as TimeCardValue;
      const totalDays = tc.pages.reduce((acc: number, p: TimeCardPage) => acc + p.days.length, 0);
      const warningsMap = computeTimeCardWarnings(tc);
      let count = 0;
      for (const h of warningsMap.values()) {
        if (h.color !== 'none') count++;
      }
      return { total: totalDays, warnings: count };
    } else {
      const pr = record.value as PayrollValue;
      const totalPages = pr.pages.length;
      const warningsMap = computePayrollWarnings(pr);
      let count = 0;
      for (const h of warningsMap.values()) {
        if (h.color !== 'none') count++;
      }
      return { total: totalPages, warnings: count };
    }
  }, [record]);

  return (
    <div>
      {/* Header Glassmorphism Estilo Apple */}
      <header className="app-header">
        <div className="brand-container">
          <div className="brand-icon-wrapper">
            <FileSpreadsheet size={20} />
          </div>
          <div>
            <span className="brand-title">Desafio Programador - Quick Filler</span>
            <span className="brand-badge" style={{ marginLeft: '0.625rem' }}>
              Auditoria Trabalhista
            </span>
          </div>
        </div>

        {currentId && record?.status === 'concluido' && (
          <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
            <button
              type="button"
              className="apple-btn apple-btn-primary"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? (
                <>
                  <Loader2 size={15} className="spinner" /> Salvando...
                </>
              ) : saveStatus === 'saved' ? (
                <>
                  <CheckCircle2 size={15} /> Salvo
                </>
              ) : (
                <>
                  <Save size={15} /> Salvar Edições
                </>
              )}
            </button>

            <button
              type="button"
              className="apple-btn apple-btn-excel"
              onClick={() => handleDownload('xlsx')}
              title="Baixar Planilha Formatada (.xlsx)"
            >
              <Download size={15} /> Excel (.xlsx)
            </button>

            <button
              type="button"
              className="apple-btn apple-btn-secondary"
              onClick={() => handleDownload('csv')}
              title="Baixar CSV (.csv)"
            >
              <Download size={15} /> CSV
            </button>

            <button
              type="button"
              className="apple-btn apple-btn-secondary"
              onClick={() => handleDownload('json')}
              title="Baixar JSON Canônico (.json)"
            >
              <Download size={15} /> JSON
            </button>
          </div>
        )}
      </header>

      {/* Container Principal */}
      <main className="main-container">
        {/* Seção de Upload & Segmented Control */}
        <UploadSection
          tipo={tipo}
          onTipoChange={setTipo}
          onUploadStart={handleUploadStart}
          onUploadSuccess={handleUploadSuccess}
          onUploadError={handleUploadError}
          isProcessing={isProcessing}
        />

        {/* Mensagem de Erro se houver */}
        {errorMessage && (
          <div
            style={{
              background: 'var(--warning-red-bg)',
              color: 'var(--warning-red-text)',
              border: '1px solid var(--warning-red-border)',
              padding: '0.75rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              fontWeight: 500,
              fontSize: '0.875rem',
              boxShadow: 'var(--shadow-apple-subtle)',
            }}
          >
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Barra de Toolbar & Legenda */}
        <LegendBar
          totalItems={stats.total}
          totalWarnings={stats.warnings}
          tipo={record?.tipo || tipo}
        />

        {/* Workspace Split-View (PDF à esquerda, Tabela à direita) */}
        <div className="split-workspace">
          {/* Painel Esquerdo: PDF Original */}
          <div className="apple-card panel-container">
            <div className="panel-header">
              <div className="panel-title">
                <Clock size={16} color="var(--apple-blue)" />
                Documento Original (PDF)
              </div>
              {currentId && (
                <span style={{ fontSize: '0.75rem', color: 'var(--apple-text-tertiary)' }}>
                  ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{currentId}</code>
                </span>
              )}
            </div>
            <div className="panel-body">
              <PdfViewer transcriptionId={currentId} />
            </div>
          </div>

          {/* Painel Direito: Transcrição e Edição */}
          <div className="apple-card panel-container">
            <div className="panel-header">
              <div className="panel-title">
                {record?.tipo === 'holerite' ? (
                  <DollarSign size={16} color="var(--apple-blue)" />
                ) : (
                  <Clock size={16} color="var(--apple-blue)" />
                )}
                Matriz de Transcrição ({record?.tipo === 'holerite' ? 'Holerite' : 'Cartão de Ponto'})
              </div>
              {record?.status === 'concluido' && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    background: 'var(--success-bg)',
                    color: 'var(--success-text)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--radius-pill)',
                    fontWeight: 600,
                  }}
                >
                  ✓ Pronto para Edição
                </span>
              )}
            </div>
            <div className="panel-body">
              {!record || record.status === 'processando' ? (
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
                    <FileSpreadsheet size={32} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--apple-text-primary)', fontSize: '0.95rem' }}>
                      {isProcessing ? 'Extraindo Estrutura...' : 'Aguardando Documento'}
                    </div>
                    <div style={{ fontSize: '0.8rem', marginTop: '0.25rem', maxWidth: '320px' }}>
                      {isProcessing
                        ? 'O motor de layout está agrupando linhas e checando consistência de caracteres...'
                        : 'Envie um Cartão de Ponto ou Holerite para iniciar a revisão interativa.'}
                    </div>
                  </div>
                </div>
              ) : record.tipo === 'cartao-ponto' && record.value ? (
                <TimeCardGrid
                  value={record.value as TimeCardValue}
                  onChange={handleValueChange}
                />
              ) : record.tipo === 'holerite' && record.value ? (
                <PayrollGrid
                  value={record.value as PayrollValue}
                  onChange={handleValueChange}
                />
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
