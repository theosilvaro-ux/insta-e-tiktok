import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  Music2,
  Unplug,
} from 'lucide-react';
import type { ConnectedAccountPublic, PlatformId } from '../types';
import { formatDateTimeBr } from '../lib/format';

interface AccountsPanelProps {
  accounts: Record<PlatformId, ConnectedAccountPublic>;
  onConnect: (platform: PlatformId) => Promise<void>;
  onDisconnect: (platform: PlatformId) => Promise<void>;
  connectingPlatform: PlatformId | null;
  oauthError: { platform: PlatformId; message: string; callbackUrl?: string } | null;
}

export function AccountsPanel({
  accounts,
  onConnect,
  onDisconnect,
  connectingPlatform,
  oauthError,
}: AccountsPanelProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const platforms: Array<{
    id: PlatformId;
    title: string;
    subtitle: string;
    scopesLabel: string;
    portalUrl: string;
    portalLabel: string;
    envVars: string[];
  }> = [
    {
      id: 'instagram',
      title: 'Instagram Reels',
      subtitle: 'Publicação direta via Instagram API with Instagram Login (Reels & Feed)',
      scopesLabel: 'Permissões: instagram_business_basic · instagram_business_content_publish',
      portalUrl: 'https://developers.facebook.com/apps/',
      portalLabel: 'Meta for Developers',
      envVars: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
    },
    {
      id: 'tiktok',
      title: 'TikTok',
      subtitle: 'Upload direto de vídeo via TikTok Content Posting API v2',
      scopesLabel: 'Permissões: user.info.basic · video.upload · video.publish',
      portalUrl: 'https://developers.tiktok.com/apps/',
      portalLabel: 'TikTok for Developers',
      envVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Contas Conectadas
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Vincule suas contas oficiais do Instagram e TikTok via OAuth para liberar a publicação automática.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {platforms.map((meta) => {
          const acc = accounts[meta.id];
          const isConnecting = connectingPlatform === meta.id;
          const platformError = oauthError?.platform === meta.id ? oauthError : null;
          const Icon = meta.id === 'instagram' ? Instagram : Music2;

          return (
            <section
              key={meta.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-6"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-900">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold text-slate-900 truncate">
                        {meta.title}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">{meta.subtitle}</p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${
                      acc.connected ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {acc.connected ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Conectado
                      </>
                    ) : (
                      'Não conectado'
                    )}
                  </span>
                </div>

                {acc.connected ? (
                  <div className="flex items-center gap-3.5 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                    {acc.avatarUrl ? (
                      <img
                        src={acc.avatarUrl}
                        alt={`Foto de perfil de ${acc.username || meta.title}`}
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 rounded-lg object-cover shrink-0 border border-slate-200"
                      />
                    ) : (
                      <div className="h-11 w-11 rounded-lg bg-slate-900 text-white flex items-center justify-center font-display font-semibold text-sm shrink-0">
                        {(acc.username || meta.title).slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {acc.displayName || `@${acc.username}`}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">@{acc.username}</span>
                        {acc.accountType && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{acc.accountType}</span>
                          </>
                        )}
                        {acc.connectedAt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              Desde {formatDateTimeBr(acc.connectedAt)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">{meta.scopesLabel}</div>
                )}

                {platformError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2"
                  >
                    <div className="flex items-start gap-2 font-medium">
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                      <span>{platformError.message}</span>
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-700">URL de Callback OAuth</span>
                    <a
                      href={meta.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline whitespace-nowrap"
                    >
                      {meta.portalLabel}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-md bg-slate-50 border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-700">
                      {acc.callbackUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopy(acc.callbackUrl)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0 transition-colors"
                    >
                      {copiedUrl === acc.callbackUrl ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </>
                      )}
                    </button>
                  </div>

                  {!acc.oauthConfigured && (
                    <p className="text-xs text-amber-700">
                      Variáveis ausentes no servidor:{' '}
                      <span className="font-mono">{meta.envVars.join(' e ')}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                {acc.connected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void onConnect(meta.id)}
                      disabled={isConnecting}
                      className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors disabled:opacity-50"
                    >
                      {isConnecting ? 'Reconectando...' : 'Reconectar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDisconnect(meta.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-medium text-red-700 whitespace-nowrap transition-colors"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onConnect(meta.id)}
                    disabled={isConnecting}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-50"
                  >
                    {isConnecting
                      ? 'Abrindo autorização...'
                      : `Conectar ${meta.id === 'instagram' ? 'Instagram' : 'TikTok'}`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
