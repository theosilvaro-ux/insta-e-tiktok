import { useEffect, useState } from 'react';
import { CheckCircle2, Save } from 'lucide-react';
import type { AutomationDefaults, PlatformId, TikTokPostOptions } from '../types';

interface AutomationPanelProps {
  automation: AutomationDefaults;
  onSave: (patch: Partial<AutomationDefaults>) => Promise<void>;
}

export function AutomationPanel({ automation, onSave }: AutomationPanelProps) {
  const [form, setForm] = useState<AutomationDefaults>(automation);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setForm(automation);
  }, [automation]);

  const toggleDefaultTarget = (platform: PlatformId) => {
    setForm((prev) => {
      const exists = prev.defaultTargets.includes(platform);
      const next = exists
        ? prev.defaultTargets.filter((p) => p !== platform)
        : [...prev.defaultTargets, platform];
      return { ...prev, defaultTargets: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSave(form);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Regras Automáticas
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Defina o comportamento padrão para acelerar ou automatizar totalmente o envio dos seus vídeos.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Publicação automática ao soltar vídeo (1-clique)
            </h2>
            <p className="text-xs text-slate-600 max-w-xl leading-relaxed">
              Quando ativado, basta arrastar um arquivo de vídeo para a área de envio que ele já inicia o upload e publica automaticamente nas plataformas selecionadas usando suas hashtags e configurações padrão.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0 pt-1">
            <input
              type="checkbox"
              checked={form.autoPublishOnDrop}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, autoPublishOnDrop: e.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
            />
            <span className="text-xs font-semibold text-slate-900">
              {form.autoPublishOnDrop ? 'Ativado' : 'Desativado'}
            </span>
          </label>
        </div>

        <div className="space-y-3 pb-5 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-900">Destinos selecionados por padrão</div>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.defaultTargets.includes('instagram')}
                onChange={() => toggleDefaultTarget('instagram')}
                className="h-4 w-4 rounded border-slate-300"
              />
              Instagram Reels
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.defaultTargets.includes('tiktok')}
                onChange={() => toggleDefaultTarget('tiktok')}
                className="h-4 w-4 rounded border-slate-300"
              />
              TikTok
            </label>
          </div>
        </div>

        <div className="space-y-2 pb-5 border-b border-slate-100">
          <label htmlFor="default-hashtags" className="block text-sm font-semibold text-slate-900">
            Hashtags padrão
          </label>
          <input
            id="default-hashtags"
            type="text"
            value={form.defaultHashtags}
            onChange={(e) => setForm((prev) => ({ ...prev, defaultHashtags: e.target.value }))}
            placeholder="#reels #tiktok #conteudo"
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
          />
          <p className="text-xs text-slate-500">
            Preenchidas automaticamente em todo novo vídeo enviado.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <div className="text-sm font-semibold text-slate-900">Padrões do Instagram</div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.instagramShareToFeed}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, instagramShareToFeed: e.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Compartilhar Reels também no Feed
            </label>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-900">Padrões do TikTok</div>
            <div>
              <label htmlFor="default-tt-privacy" className="block text-xs text-slate-600 mb-1">
                Privacidade padrão
              </label>
              <select
                id="default-tt-privacy"
                value={form.tiktokPrivacyLevel}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    tiktokPrivacyLevel: e.target.value as TikTokPostOptions['privacyLevel'],
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
              >
                <option value="PUBLIC_TO_EVERYONE">Público (Todos)</option>
                <option value="MUTUAL_FOLLOW_FRIENDS">Amigos que se seguem</option>
                <option value="FOLLOWER_OF_CREATOR">Seguidores</option>
                <option value="SELF_ONLY">Somente eu (Privado)</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.tiktokAllowComment}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, tiktokAllowComment: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                Comentários
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.tiktokAllowDuet}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, tiktokAllowDuet: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                Dueto
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.tiktokAllowStitch}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, tiktokAllowStitch: e.target.checked }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
                Stitch
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
          <div>
            {savedNotice && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Regras salvas com sucesso
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Salvando...' : 'Salvar regras'}
          </button>
        </div>
      </section>
    </div>
  );
}
