import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Bot, Key, Shield } from 'lucide-react';
import { api, Settings } from '../lib/api';
import { AI_PROVIDER_OPTIONS } from '../lib/uiDefaults';

export default function SettingsView({
  canManageSettings,
  canViewSettings,
  loadingRole,
  onRoleRefreshRequested,
  onSettingsUpdated,
}: {
  canManageSettings: boolean,
  canViewSettings: boolean,
  loadingRole: boolean,
  onRoleRefreshRequested?: () => Promise<void>,
  onSettingsUpdated?: (settings: Settings) => void,
}) {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [settings, setSettings] = useState<Settings>({
    aiEnabled: false,
    activeProvider: 'gemini',
    aiNextBestActionEnabled: true,
    aiRiskNarrativeEnabled: true,
    aiDuplicateDetectionEnabled: true,
    aiRequireHumanApproval: true,
    privacyMode: 'public-read',
    suiteName: 'AI Librarian Suite',
    portalName: 'Project Archives',
    logoDataUrl: '',
    primaryColor: '#002045',
    brandDarkColor: '#1A365D',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<{ ownerCount: number; configured: boolean; eligible: boolean } | null>(null);
  const [claimingOwner, setClaimingOwner] = useState(false);

  const readOnly = !canManageSettings;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.getSettings();
        setSettings(data);
        onSettingsUpdated?.(data);
      } catch (error) {
        console.error('Failed to fetch settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchBootstrapStatus = async () => {
      try {
        const status = await api.getOwnerBootstrapStatus();
        setBootstrapStatus(status);
      } catch {
        setBootstrapStatus(null);
      }
    };

    void fetchBootstrapStatus();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    if (readOnly) {
      setToast({ type: 'error', message: 'You have view-only access to settings.' });
      setSaving(false);
      return;
    }
    try {
      await api.updateSettings(settings);
      onSettingsUpdated?.(settings);
      setToast({ type: 'success', message: 'Settings saved successfully.' });
    } catch (error) {
      console.error('Failed to save settings');
      setToast({ type: 'error', message: 'Failed to save settings. Ensure you have admin privileges.' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    onSettingsUpdated?.(settings);
  }, [settings.primaryColor, settings.brandDarkColor, settings.portalName, settings.suiteName, settings.logoDataUrl]);

  if (loading || loadingRole) return <div className="p-10">Loading settings...</div>;

  if (!canViewSettings) {
    return (
      <div className="p-10 max-w-3xl mx-auto text-center">
        <Shield className="w-16 h-16 text-error mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
        <p className="text-on-surface-variant">You do not have permissions to view archive settings.</p>
      </div>
    );
  }

  const claimOwnerAccess = async () => {
    setClaimingOwner(true);
    try {
      const result = await api.claimInitialOwnerAccess();
      setToast({ type: 'success', message: `${result.message} Refreshing claims...` });
      await api.refreshCurrentUserClaims(true);
      if (onRoleRefreshRequested) {
        await onRoleRefreshRequested();
      }
      setBootstrapStatus((prev) => ({ ownerCount: Math.max(prev?.ownerCount ?? 0, 1), configured: prev?.configured ?? true, eligible: false }));
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'Unable to claim owner access.' });
    } finally {
      setClaimingOwner(false);
    }
  };

  return (
    <div className="p-10 max-w-3xl mx-auto">
      {toast && (
        <div className="fixed top-6 right-6 z-50">
          <div className={`px-4 py-3 rounded-lg shadow-lg border text-sm font-bold ${
            toast.type === 'success'
              ? 'bg-tertiary-container text-on-tertiary-container border-tertiary-fixed/30'
              : 'bg-error-container text-error border-error/30'
          }`}>
            {toast.message}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-primary" />
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">Global Settings</h1>
      </div>

      {readOnly && (
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-on-surface-variant">
          You have read-only settings access. Owners and admins can edit and save changes.
        </div>
      )}

      {bootstrapStatus?.ownerCount === 0 && (
        <div className="mb-6 rounded-lg border border-tertiary-fixed/30 bg-tertiary-container/30 p-4 text-sm text-on-surface-variant space-y-3">
          <p className="font-bold text-on-surface">First owner setup</p>
          {bootstrapStatus.configured ? (
            <p>
              No owner accounts are configured yet. If your email is listed in <code>OWNER_EMAILS</code>, you can claim owner access here.
            </p>
          ) : (
            <p>
              No owner accounts exist yet. Since <code>OWNER_EMAILS</code> is not configured, the first signed-in user can claim owner access
              here.
            </p>
          )}
          <button
            onClick={claimOwnerAccess}
            disabled={!bootstrapStatus.configured || !bootstrapStatus.eligible || claimingOwner}
            className="px-4 py-2 rounded-lg bg-primary text-white font-bold disabled:opacity-50"
          >
            {claimingOwner ? 'Claiming owner access...' : bootstrapStatus.eligible ? 'Claim owner access' : 'Owner claim unavailable'}
          </button>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/20 overflow-hidden">
        <div className="p-6 border-b border-outline-variant/10 bg-surface-container-low/30">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI Integration Features
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">Configure AI capabilities across the library portal.</p>
        </div>

        <div className="p-6 space-y-8">
          <div>
            <h3 className="font-bold text-on-surface mb-3">Project Access Mode</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  id: 'public-read',
                  name: 'Public Read',
                  desc: 'Anyone can read project portfolio metadata.'
                },
                {
                  id: 'private-read',
                  name: 'Private Read (Org)',
                  desc: 'Only authenticated organizational users can read projects.'
                }
              ].map((mode) => (
                <div
                  key={mode.id}
                  onClick={() => !readOnly && setSettings({ ...settings, privacyMode: mode.id as Settings['privacyMode'] })}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.privacyMode === mode.id
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  } ${readOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="font-bold text-sm">{mode.name}</div>
                  <div className="text-xs text-on-surface-variant mt-1">{mode.desc}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-variant mt-2">
              Use private mode for institutions that require restricted access by default.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-bold text-on-surface">Branding</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-suite-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Suite Name</label>
                <input
                  id="settings-suite-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.suiteName}
                  maxLength={80}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, suiteName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-portal-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Portal Name</label>
                <input
                  id="settings-portal-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.portalName}
                  maxLength={80}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, portalName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-primary-color" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Primary Color</label>
                <input
                  id="settings-primary-color"
                  type="color"
                  className="w-16 h-10 bg-transparent border border-outline-variant/20 rounded"
                  value={settings.primaryColor}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="settings-brand-dark-color" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Dark Brand Color</label>
                <input
                  id="settings-brand-dark-color"
                  type="color"
                  className="w-16 h-10 bg-transparent border border-outline-variant/20 rounded"
                  value={settings.brandDarkColor}
                  disabled={readOnly}
                  onChange={(e) => setSettings({ ...settings, brandDarkColor: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="settings-logo-upload" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Identity Logo (optional)</label>
              <input
                id="settings-logo-upload"
                type="file"
                accept="image/*"
                disabled={readOnly}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = typeof reader.result === 'string' ? reader.result : '';
                    setSettings((prev) => ({ ...prev, logoDataUrl: result }));
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {settings.logoDataUrl && (
                <div className="mt-2 flex items-center gap-4">
                  <img src={settings.logoDataUrl} alt="Brand logo preview" className="h-10 w-10 rounded object-cover border border-outline-variant/30" />
                  <button
                    onClick={() => setSettings((prev) => ({ ...prev, logoDataUrl: '' }))}
                    disabled={readOnly}
                    className="text-xs font-bold text-error"
                  >
                    Remove Logo
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* AI Enable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-on-surface">Enable AI Features</h3>
              <p className="text-sm text-on-surface-variant">Turn on AI summaries, next-best actions, risk drafts, and duplicate detection.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.aiEnabled}
                disabled={readOnly}
                onChange={(e) => setSettings({ ...settings, aiEnabled: e.target.checked })}
              />
              <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Provider Selection */}
          <div className={`transition-opacity ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface mb-3">Active AI Provider</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {AI_PROVIDER_OPTIONS.map(provider => (
                <div
                  key={provider.id}
                  onClick={() => !readOnly && setSettings({ ...settings, activeProvider: provider.id })}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.activeProvider === provider.id
                      ? 'border-primary bg-primary/5'
                      : 'border-outline-variant/20 hover:border-primary/30'
                  } ${readOnly ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="font-bold text-sm">{provider.name}</div>
                  <div className="text-xs text-on-surface-variant mt-1">{provider.desc}</div>
                </div>
              ))}
            </div>
          </div>



          <div className={`transition-opacity space-y-4 ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface">Workflow Capabilities</h3>
            {[
              { key: 'aiNextBestActionEnabled', title: 'Next-best action suggestions', desc: 'Generate prioritized recommendations for project owners.' },
              { key: 'aiRiskNarrativeEnabled', title: 'Risk narrative drafts', desc: 'Draft board-ready risk narratives with mitigations.' },
              { key: 'aiDuplicateDetectionEnabled', title: 'Duplicate-project detection', desc: 'Surface overlap candidates before duplicate work begins.' },
              { key: 'aiRequireHumanApproval', title: 'Human approval required', desc: 'AI outputs stay in pending state until explicitly approved.' }
            ].map((feature) => (
              <div key={feature.key} className="flex items-center justify-between bg-surface-container-low rounded-lg p-3">
                <div>
                  <div className="text-sm font-bold">{feature.title}</div>
                  <div className="text-xs text-on-surface-variant mt-0.5">{feature.desc}</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings[feature.key as keyof Settings] as boolean}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, [feature.key]: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            ))}
          </div>

                    {/* API Key Notice */}
          <div className="bg-tertiary-container/30 border border-tertiary-fixed-dim/30 rounded-lg p-4 flex gap-3">
            <Key className="w-5 h-5 text-tertiary-fixed shrink-0 mt-0.5" />
            <div className="text-sm text-on-surface-variant">
              <strong className="text-on-surface block mb-1">API Key Configuration</strong>
              To use these providers, you must configure the corresponding API keys in the server environment variables (<code>.env</code>). Keys are securely handled server-side and never exposed to the client.
            </div>
          </div>
        </div>

        <div className="p-6 bg-surface-container-low border-t border-outline-variant/10 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || readOnly}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-70"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : readOnly ? 'View Only' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
