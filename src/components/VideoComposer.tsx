import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Film,
  Instagram,
  Loader2,
  Music2,
  RefreshCw,
  Send,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  AutomationDefaults,
  ConnectedAccountPublic,
  PlatformId,
  PublishJob,
  PublishMode,
  TikTokPostOptions,
} from '../types';
import {
  formatBytes,
  formatDuration,
  getDefaultScheduleLocalValue,
  getStatusLabel,
} from '../lib/format';

interface VideoComposerProps {
  accounts: Record<PlatformId, ConnectedAccountPublic>;
  automation: AutomationDefaults;
  latestJob: PublishJob | null;
  getIdToken: () => Promise<string>;
  onJobCreated: (job: PublishJob) => void;
  onRetryJob: (jobId: string) => Promise<void>;
  onConnectPlatform: (platform: PlatformId) => Promise<void>;
  onOpenQueue: () => void;
}

const QUICK_HASHTAGS = [
  '#reels #tiktok #viral',
  '#fyp #paravoce #conteudo',
  '#dicas #criadordeconteudo',
  '#rotina #bastidores',
];

export function VideoComposer({
  accounts,
  automation,
  latestJob,
  getIdToken,
  onJobCreated,
  onRetryJob,
  onConnectPlatform,
  onOpenQueue,
}: VideoComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState({ durationSec: 0, width: 0, height: 0 });
  const [coverTimeSec, setCoverTimeSec] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState(automation.defaultHashtags);
  const [igEnabled, setIgEnabled] = useState(automation.defaultTargets.includes('instagram'));
  const [ttEnabled, setTtEnabled] = useState(automation.defaultTargets.includes('tiktok'));

  const [shareToFeed, setShareToFeed] = useState(automation.instagramShareToFeed);
  const [ttPrivacy, setTtPrivacy] = useState<TikTokPostOptions['privacyLevel']>(
    automation.tiktokPrivacyLevel,
  );
  const [ttAllowComment, setTtAllowComment] = useState(automation.tiktokAllowComment);
  const [ttAllowDuet, setTtAllowDuet] = useState(automation.tiktokAllowDuet);
  const [ttAllowStitch, setTtAllowStitch] = useState(automation.tiktokAllowStitch);

  const [mode, setMode] = useState<PublishMode>('now');
  const [scheduledLocal, setScheduledLocal] = useState(getDefaultScheduleLocalValue);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setHashtags((prev) => (prev ? prev : automation.defaultHashtags));
  }, [automation.defaultHashtags]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const submitVideoFile = async (
    file: File,
    metaOverride?: { durationSec: number; width: number; height: number },
  ) => {
    const targets: PlatformId[] = [];
    if (igEnabled) targets.push('instagram');
    if (ttEnabled) targets.push('tiktok');

    if (targets.length === 0) {
      setErrorMessage('Selecione pelo menos uma plataforma (Instagram ou TikTok).');
      return;
    }

    if (mode === 'schedule' && !scheduledLocal) {
      setErrorMessage('Escolha a data e o horário do agendamento.');
      return;
    }

    setErrorMessage(null);
    setIsUploading(true);
    setUploadPercent(0);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('caption', caption.slice(0, 2200));
    formData.append('hashtags', hashtags.slice(0, 500));
    formData.append('targets', JSON.stringify(targets));
    formData.append('mode', mode);
    if (mode === 'schedule') {
      const iso = new Date(scheduledLocal).toISOString();
      formData.append('scheduledAt', iso);
    }
    formData.append('coverTimestampMs', String(Math.round(coverTimeSec * 1000)));
    formData.append('instagramOptions', JSON.stringify({ shareToFeed }));
    formData.append(
      'tiktokOptions',
      JSON.stringify({
        privacyLevel: ttPrivacy,
        allowComment: ttAllowComment,
        allowDuet: ttAllowDuet,
        allowStitch: ttAllowStitch,
      }),
    );
    formData.append('videoMeta', JSON.stringify(metaOverride || videoMeta));

    try {
      const idToken = await getIdToken();
      const job = await new Promise<PublishJob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/posts', true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadPercent(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText) as { job?: PublishJob; error?: string };
            if (xhr.status >= 200 && xhr.status < 300 && parsed.job) {
              resolve(parsed.job);
            } else {
              reject(new Error(parsed.error || 'Falha ao enviar o vídeo para o servidor.'));
            }
          } catch {
            reject(new Error('Resposta inválida do servidor ao enviar vídeo.'));
          }
        };

        xhr.onerror = () => reject(new Error('Erro de rede ao enviar o vídeo.'));
        xhr.send(formData);
      });

      onJobCreated(job);
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setVideoMeta({ durationSec: 0, width: 0, height: 0 });
      setCoverTimeSec(0);
      setCaption('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado ao publicar.');
    } finally {
      setIsUploading(false);
      setUploadPercent(0);
    }
  };

  const acceptFile = (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      setErrorMessage('Formato inválido. Envie um arquivo MP4, MOV ou WebM.');
      return;
    }

    setErrorMessage(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
    setCoverTimeSec(0);
    setVideoMeta({ durationSec: 0, width: 0, height: 0 });

    if (automation.autoPublishOnDrop && (igEnabled || ttEnabled)) {
      void submitVideoFile(file, { durationSec: 0, width: 0, height: 0 });
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  const handleClearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setVideoMeta({ durationSec: 0, width: 0, height: 0 });
    setCoverTimeSec(0);
  };

  const handleCoverSeek = (seconds: number) => {
    setCoverTimeSec(seconds);
    if (videoRef.current && Number.isFinite(seconds)) {
      videoRef.current.currentTime = seconds;
    }
  };

  const handleAppendTags = (tagGroup: string) => {
    setHashtags((prev) => {
      const clean = prev.trim();
      if (!clean) return tagGroup;
      return `${clean} ${tagGroup}`;
    });
  };

  const combinedLength =
    caption.trim().length + (hashtags.trim() ? hashtags.trim().length + 2 : 0);

  const isVertical =
    videoMeta.width > 0 && videoMeta.height > 0 ? videoMeta.height >= videoMeta.width : true;

  const selectedTargetsCount = Number(igEnabled) + Number(ttEnabled);
  const disconnectedTargets: PlatformId[] = [];
  if (igEnabled && !accounts.instagram.connected) disconnectedTargets.push('instagram');
  if (ttEnabled && !accounts.tiktok.connected) disconnectedTargets.push('tiktok');

  const submitLabel = (() => {
    if (isUploading) return `Enviando vídeo (${uploadPercent}%)...`;
    if (mode === 'schedule') return 'Agendar publicação automática';
    if (igEnabled && ttEnabled) return 'Publicar agora no Instagram e TikTok';
    if (igEnabled) return 'Publicar agora no Instagram Reels';
    if (ttEnabled) return 'Publicar agora no TikTok';
    return 'Selecione uma plataforma';
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 text-balance">
            Publicar Vídeo Automático
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Envie o arquivo uma única vez para distribuir automaticamente no Instagram Reels e no TikTok.
          </p>
        </div>

        {automation.autoPublishOnDrop && (
          <div className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 whitespace-nowrap shrink-0">
            Modo 1-clique ativo: soltar vídeo já publica
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Video File + Caption */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                1. Arquivo de vídeo
              </h2>
              {selectedFile && (
                <button
                  type="button"
                  onClick={handleClearFile}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Trocar vídeo
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
              onChange={handleFileChange}
              className="hidden"
            />

            {!selectedFile || !previewUrl ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/60'
                    : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-700">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-900">
                  Arraste seu vídeo para cá ou clique para escolher
                </p>
                <p className="mt-1.5 text-xs text-slate-500">
                  MP4, MOV ou WebM até 512 MB · Formato ideal 9:16 (1080×1920)
                </p>
                <div className="mt-5">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold">
                    <Film className="h-3.5 w-3.5" />
                    Selecionar arquivo
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
                  <div className="sm:col-span-5 bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center aspect-[9/16] max-h-[360px] mx-auto w-full">
                    <video
                      ref={videoRef}
                      src={previewUrl}
                      controls
                      playsInline
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        setVideoMeta({
                          durationSec: v.duration || 0,
                          width: v.videoWidth || 0,
                          height: v.videoHeight || 0,
                        });
                      }}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="sm:col-span-7 space-y-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900 break-all">
                        {selectedFile.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 font-mono tabular-nums">
                        <span>{formatBytes(selectedFile.size)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDuration(videoMeta.durationSec)}</span>
                        {videoMeta.width > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {videoMeta.width}×{videoMeta.height}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {!isVertical && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        Este vídeo está em proporção horizontal. Reels e TikTok têm melhor alcance no formato vertical 9:16.
                      </div>
                    )}

                    {videoMeta.durationSec > 0 && (
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between text-xs">
                          <label htmlFor="cover-scrubber" className="font-medium text-slate-700">
                            Frame de capa (thumbnail)
                          </label>
                          <span className="font-mono tabular-nums text-slate-500">
                            {coverTimeSec.toFixed(1)}s
                          </span>
                        </div>
                        <input
                          id="cover-scrubber"
                          type="range"
                          min={0}
                          max={Math.max(0.1, videoMeta.durationSec)}
                          step={0.1}
                          value={coverTimeSec}
                          onChange={(e) => handleCoverSeek(Number(e.target.value))}
                          className="w-full accent-slate-900 cursor-pointer"
                        />
                        <p className="text-xs text-slate-500">
                          Arraste para escolher o segundo exato da capa no Reels e TikTok.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                2. Legenda e hashtags
              </h2>
              <span
                className={`font-mono text-xs tabular-nums ${
                  combinedLength > 2200 ? 'text-red-600 font-semibold' : 'text-slate-500'
                }`}
              >
                {combinedLength} / 2.200
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="caption-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Descrição do vídeo
                </label>
                <textarea
                  id="caption-input"
                  rows={4}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escreva a legenda que será publicada automaticamente no Instagram e no TikTok..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div>
                <label htmlFor="hashtags-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Hashtags (anexadas ao final)
                </label>
                <input
                  id="hashtags-input"
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="#reels #tiktok #conteudo"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Sugestões rápidas:</span>
                  {QUICK_HASHTAGS.map((group) => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => handleAppendTags(group)}
                      className="text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md px-2 py-1 transition-colors whitespace-nowrap"
                    >
                      + {group}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Destinations, Schedule & Launch */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
            <h2 className="font-display text-base font-semibold text-slate-900">
              3. Onde publicar automaticamente
            </h2>

            {/* Instagram Destination */}
            <div className="p-4 rounded-lg border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={igEnabled}
                    onChange={(e) => setIgEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
                  />
                  <Instagram className="h-4 w-4 text-slate-800 shrink-0" />
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    Instagram Reels
                  </span>
                </label>

                {accounts.instagram.connected ? (
                  <span className="text-xs font-mono text-emerald-700 truncate max-w-[140px]">
                    @{accounts.instagram.username}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onConnectPlatform('instagram')}
                    className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap shrink-0"
                  >
                    Conectar conta
                  </button>
                )}
              </div>

              {igEnabled && (
                <label className="flex items-center gap-2 pt-2 border-t border-slate-100 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shareToFeed}
                    onChange={(e) => setShareToFeed(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
                  />
                  Compartilhar também no Feed do perfil
                </label>
              )}
            </div>

            {/* TikTok Destination */}
            <div className="p-4 rounded-lg border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={ttEnabled}
                    onChange={(e) => setTtEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
                  />
                  <Music2 className="h-4 w-4 text-slate-800 shrink-0" />
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    TikTok
                  </span>
                </label>

                {accounts.tiktok.connected ? (
                  <span className="text-xs font-mono text-emerald-700 truncate max-w-[140px]">
                    @{accounts.tiktok.username}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onConnectPlatform('tiktok')}
                    className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap shrink-0"
                  >
                    Conectar conta
                  </button>
                )}
              </div>

              {ttEnabled && (
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <div>
                    <label
                      htmlFor="tt-privacy"
                      className="block text-xs font-medium text-slate-600 mb-1"
                    >
                      Privacidade no TikTok
                    </label>
                    <select
                      id="tt-privacy"
                      value={ttPrivacy}
                      onChange={(e) =>
                        setTtPrivacy(e.target.value as TikTokPostOptions['privacyLevel'])
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="PUBLIC_TO_EVERYONE">Público (Todos)</option>
                      <option value="MUTUAL_FOLLOW_FRIENDS">Amigos que se seguem</option>
                      <option value="FOLLOWER_OF_CREATOR">Seguidores</option>
                      <option value="SELF_ONLY">Somente eu (Rascunho privado)</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-700">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ttAllowComment}
                        onChange={(e) => setTtAllowComment(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      Comentários
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ttAllowDuet}
                        onChange={(e) => setTtAllowDuet(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      Dueto
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ttAllowStitch}
                        onChange={(e) => setTtAllowStitch(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      Stitch
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Publish Timing */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-700">Quando publicar</div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMode('now')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    mode === 'now'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  Publicar Agora
                </button>
                <button
                  type="button"
                  onClick={() => setMode('schedule')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    mode === 'schedule'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Agendar
                </button>
              </div>

              {mode === 'schedule' && (
                <div>
                  <label htmlFor="schedule-input" className="block text-xs text-slate-600 mb-1">
                    Data e hora da publicação automática
                  </label>
                  <input
                    id="schedule-input"
                    type="datetime-local"
                    value={scheduledLocal}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {disconnectedTargets.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                Conecte{' '}
                {disconnectedTargets
                  .map((p) => (p === 'instagram' ? 'Instagram' : 'TikTok'))
                  .join(' e ')}{' '}
                em <strong>Contas Conectadas</strong> para que a postagem seja concluída nas plataformas.
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Enviando vídeo ao servidor...</span>
                  <span className="font-mono tabular-nums font-semibold">{uploadPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!selectedFile || isUploading || selectedTargetsCount === 0}
              onClick={() => {
                if (selectedFile) void submitVideoFile(selectedFile);
              }}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500 text-sm font-semibold text-white transition-colors whitespace-nowrap"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === 'schedule' ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>{submitLabel}</span>
            </button>
          </section>

          {/* Latest Job Live Delivery Status */}
          {latestJob && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-500">Último envio</div>
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {latestJob.video.originalName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenQueue}
                  className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap shrink-0"
                >
                  Ver fila completa
                </button>
              </div>

              <div className="space-y-2.5">
                {(['instagram', 'tiktok'] as const).map((platform) => {
                  const d = latestJob.deliveries[platform];
                  if (!d.enabled) return null;
                  const isBusy = d.status === 'uploading' || d.status === 'processing';
                  const isOk = d.status === 'published';
                  const isFail = d.status === 'failed';

                  return (
                    <div
                      key={platform}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {platform === 'instagram' ? 'Instagram Reels' : 'TikTok'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            isOk
                              ? 'text-emerald-700'
                              : isFail
                                ? 'text-red-700'
                                : isBusy
                                  ? 'text-blue-700'
                                  : 'text-amber-700'
                          }`}
                        >
                          {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {isOk && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {isFail && <AlertCircle className="h-3.5 w-3.5" />}
                          {getStatusLabel(d.status)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        {d.error ? d.error : d.progressMessage}
                      </p>
                      <div className="flex items-center gap-3">
                        {d.permalink && (
                          <a
                            href={d.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            Abrir publicação
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {isFail && (
                          <button
                            type="button"
                            onClick={() => void onRetryJob(latestJob.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-800 hover:underline"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Tentar novamente
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
