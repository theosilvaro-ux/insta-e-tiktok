import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { PlatformDeliveryState, PublishJob, TargetStatus } from '../types';
import {
  formatBytes,
  formatDateTimeBr,
  formatDuration,
  getStatusLabel,
} from '../lib/format';

interface JobsTableProps {
  jobs: PublishJob[];
  loading: boolean;
  onRetry: (jobId: string) => Promise<void>;
  onPublishNow: (jobId: string) => Promise<void>;
  onDelete: (jobId: string) => Promise<void>;
  onGoToCompose: () => void;
}

type StatusFilter = 'all' | 'published' | 'scheduled' | 'processing' | 'failed';

function StatusText({ delivery }: { delivery: PlatformDeliveryState }) {
  if (!delivery.enabled) {
    return <span className="text-xs text-slate-400">Não incluído</span>;
  }

  const s: TargetStatus = delivery.status;
  const colorClass =
    s === 'published'
      ? 'text-emerald-700'
      : s === 'failed'
        ? 'text-red-700'
        : s === 'uploading' || s === 'processing'
          ? 'text-blue-700'
          : 'text-amber-700';

  return (
    <div className="space-y-0.5">
      <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${colorClass}`}>
        {s === 'published' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
        {(s === 'uploading' || s === 'processing') && (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        )}
        {s === 'scheduled' && <CalendarClock className="h-3.5 w-3.5 shrink-0" />}
        {s === 'failed' && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
        <span>{getStatusLabel(s)}</span>
      </div>
      {delivery.error && (
        <div className="text-[11px] text-red-600 line-clamp-1" title={delivery.error}>
          {delivery.error}
        </div>
      )}
    </div>
  );
}

export function JobsTable({
  jobs,
  loading,
  onRetry,
  onPublishNow,
  onDelete,
  onGoToCompose,
}: JobsTableProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedJob, setSelectedJob] = useState<PublishJob | null>(null);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesSearch =
        !q ||
        job.video.originalName.toLowerCase().includes(q) ||
        job.caption.toLowerCase().includes(q) ||
        job.hashtags.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (filter === 'all') return true;
      const deliveries = [job.deliveries.instagram, job.deliveries.tiktok].filter(
        (d) => d.enabled,
      );
      if (filter === 'published') {
        return deliveries.length > 0 && deliveries.every((d) => d.status === 'published');
      }
      if (filter === 'scheduled') {
        return deliveries.some((d) => d.status === 'scheduled');
      }
      if (filter === 'processing') {
        return deliveries.some(
          (d) => d.status === 'uploading' || d.status === 'processing',
        );
      }
      if (filter === 'failed') {
        return deliveries.some((d) => d.status === 'failed');
      }
      return true;
    });
  }, [jobs, search, filter]);

  const filterTabs: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'published', label: 'Publicados' },
    { id: 'scheduled', label: 'Agendados' },
    { id: 'processing', label: 'Em envio' },
    { id: 'failed', label: 'Com erro' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Fila e Histórico de Publicações
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Acompanhe envios em andamento, publicações agendadas e resultados no Instagram e TikTok.
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToCompose}
          className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
        >
          Novo vídeo
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por arquivo ou legenda..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Table States */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {[1, 2, 3].map((n) => (
            <div key={n} className="p-4 flex items-center justify-between gap-4 animate-pulse">
              <div className="h-4 w-48 bg-slate-100 rounded" />
              <div className="h-4 w-28 bg-slate-100 rounded" />
              <div className="h-4 w-24 bg-slate-100 rounded" />
              <div className="h-4 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Film className="h-6 w-6" />
          </div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            {jobs.length === 0
              ? 'Nenhum vídeo enviado ainda'
              : 'Nenhuma publicação encontrada com esse filtro'}
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {jobs.length === 0
              ? 'Envie seu primeiro vídeo para publicar automaticamente no Instagram Reels e no TikTok.'
              : 'Limpe a busca ou troque o filtro de status para visualizar suas publicações.'}
          </p>
          {jobs.length === 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onGoToCompose}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors"
              >
                Enviar primeiro vídeo
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Vídeo</th>
                  <th className="py-3 px-4">Legenda</th>
                  <th className="py-3 px-4">Instagram Reels</th>
                  <th className="py-3 px-4">TikTok</th>
                  <th className="py-3 px-4">Data / Agendamento</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredJobs.map((job) => {
                  const hasFailed =
                    (job.deliveries.instagram.enabled &&
                      job.deliveries.instagram.status === 'failed') ||
                    (job.deliveries.tiktok.enabled && job.deliveries.tiktok.status === 'failed');

                  const hasScheduled =
                    (job.deliveries.instagram.enabled &&
                      job.deliveries.instagram.status === 'scheduled') ||
                    (job.deliveries.tiktok.enabled &&
                      job.deliveries.tiktok.status === 'scheduled');

                  return (
                    <tr key={job.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top">
                        <div className="font-medium text-slate-900 max-w-[200px] truncate">
                          {job.video.originalName}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                          {formatBytes(job.video.sizeBytes)}
                          {job.video.durationSec > 0 && ` · ${formatDuration(job.video.durationSec)}`}
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top max-w-[240px]">
                        <div className="text-xs text-slate-700 line-clamp-2">
                          {job.caption || <span className="text-slate-400">Sem legenda</span>}
                        </div>
                      </td>

                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <StatusText delivery={job.deliveries.instagram} />
                      </td>

                      <td className="py-3 px-4 align-top whitespace-nowrap">
                        <StatusText delivery={job.deliveries.tiktok} />
                      </td>

                      <td className="py-3 px-4 align-top whitespace-nowrap font-mono text-xs tabular-nums text-slate-600">
                        {job.mode === 'schedule' && job.scheduledAt
                          ? formatDateTimeBr(job.scheduledAt)
                          : formatDateTimeBr(job.createdAt)}
                      </td>

                      <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {hasScheduled && (
                            <button
                              type="button"
                              onClick={() => void onPublishNow(job.id)}
                              title="Publicar agora"
                              className="p-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {hasFailed && (
                            <button
                              type="button"
                              onClick={() => void onRetry(job.id)}
                              title="Tentar novamente"
                              className="p-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedJob(job)}
                            title="Ver detalhes"
                            className="p-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDelete(job.id)}
                            title="Excluir"
                            className="p-1.5 rounded-md border border-slate-200 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setSelectedJob(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-slate-900 truncate">
                  {selectedJob.video.originalName}
                </h3>
                <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  Enviado em {formatDateTimeBr(selectedJob.createdAt)} ·{' '}
                  {formatBytes(selectedJob.video.sizeBytes)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                aria-label="Fechar detalhes"
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
              <div className="sm:col-span-5 bg-slate-950 rounded-lg overflow-hidden aspect-[9/16] max-h-[300px] mx-auto w-full">
                <video
                  src={`/uploads/${encodeURIComponent(selectedJob.video.filename)}`}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="sm:col-span-7 space-y-4">
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">Legenda e hashtags</div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {selectedJob.caption || 'Sem legenda'}
                    {selectedJob.hashtags ? `\n\n${selectedJob.hashtags}` : ''}
                  </p>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                  {(['instagram', 'tiktok'] as const).map((p) => {
                    const d = selectedJob.deliveries[p];
                    if (!d.enabled) return null;
                    return (
                      <div key={p} className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            {p === 'instagram' ? 'Instagram Reels' : 'TikTok'}
                          </span>
                          <StatusText delivery={d} />
                        </div>
                        <p className="text-xs text-slate-600">{d.progressMessage}</p>
                        {d.error && <p className="text-xs text-red-700">{d.error}</p>}
                        {d.permalink && (
                          <a
                            href={d.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline pt-1"
                          >
                            Ver publicação no ar
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
