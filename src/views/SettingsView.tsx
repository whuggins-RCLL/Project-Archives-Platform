import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Bot, Key, Shield, Calendar, HardDrive, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { api, Settings, CalendarSyncReport } from '../lib/api';
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
    aiAutoTagEnabled: true,
    aiSummarizeEnabled: true,
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
    googleCalendarEnabled: false,
    googleCalendarId: '',
    googleCalendarUrl: '',
    googleCalendarTimezone: '',
    googleDriveEnabled: false,
    googleDriveId: '',
    googleDriveUrl: '',
    googleDriveFolderId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<{ ownerCount: number; configured: boolean; eligible: boolean } | null>(null);
  const [claimingOwner, setClaimingOwner] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [testingCalendar, setTestingCalendar] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  const [calendarSyncReport, setCalendarSyncReport] = useState<CalendarSyncReport | null>(null);

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

  useEffect(() => {
    const fetchIntegrationStatus = async () => {
      try {
        const status = await api.getIntegrationStatus();
        setServiceAccountEmail(status.serviceAccountEmail);
      } catch {
        setServiceAccountEmail(null);
      }
    };

    if (canViewSettings) void fetchIntegrationStatus();
  }, [canViewSettings]);

  const runCalendarTest = async () => {
    setTestingCalendar(true);
    try {
      const result = await api.testGoogleCalendar();
      setToast({
        type: 'success',
        message: `Connected to "${result.summary || result.calendarId}" (${result.timezone || 'default timezone'}).`,
      });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to reach Google Calendar.',
      });
    } finally {
      setTestingCalendar(false);
    }
  };

  const runCalendarSync = async () => {
    setSyncingCalendar(true);
    try {
      const report = await api.syncProjectsToCalendar();
      setCalendarSyncReport(report);
      const { created, updated, skipped, failed } = report.totals;
      setToast({
        type: failed > 0 ? 'error' : 'success',
        message: `Calendar sync complete: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed.`,
      });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to sync calendar.',
      });
    } finally {
      setSyncingCalendar(false);
    }
  };

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
      console.error('Failed to save settings', error);
      const raw = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'Failed to save settings. Ensure you have admin privileges.';
      // Keep the toast readable by truncating long server detail strings.
      const message = raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
      setToast({ type: 'error', message });
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
            disabled={!bootstrapStatus.eligible || claimingOwner}
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
            <p className="text-sm text-on-surface-variant -mt-2 mb-1">
              Use a clear organization title as the main name. The product line appears in smaller UI labels so you are not repeating the same phrase in the sidebar and header.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-portal-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Primary name (organization)</label>
                <input
                  id="settings-portal-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.portalName}
                  maxLength={80}
                  disabled={readOnly}
                  placeholder="e.g. Library Technology and Innovation"
                  onChange={(e) => setSettings({ ...settings, portalName: e.target.value })}
                />
                <p className="text-xs text-on-surface-variant mt-1.5">Shown as the main title in the sidebar, top bar, and public site header.</p>
              </div>
              <div>
                <label htmlFor="settings-suite-name" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Product line (short)</label>
                <input
                  id="settings-suite-name"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                  value={settings.suiteName}
                  maxLength={80}
                  disabled={readOnly}
                  placeholder="e.g. Project workspace"
                  onChange={(e) => setSettings({ ...settings, suiteName: e.target.value })}
                />
                <p className="text-xs text-on-surface-variant mt-1.5">A short product label under the primary name; avoid duplicating the organization title.</p>
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
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-outline-variant/30 bg-white">
                    <img src={settings.logoDataUrl} alt="Brand logo preview" className="max-h-14 max-w-14 object-contain" />
                  </div>
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
            <div>
              <label htmlFor="settings-custom-footer" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Custom Footer</label>
              <input
                id="settings-custom-footer"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                value={settings.customFooter ?? ''}
                maxLength={500}
                disabled={readOnly}
                placeholder="e.g. © My Organization. All rights reserved."
                onChange={(e) => setSettings({ ...settings, customFooter: e.target.value })}
              />
              <p className="text-xs text-on-surface-variant mt-1">Displayed in the public portal footer. Leave blank to use the default.</p>
            </div>
            <div>
              <label htmlFor="settings-help-email" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">Help Contact Email</label>
              <input
                id="settings-help-email"
                type="email"
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                value={settings.helpContactEmail ?? ''}
                maxLength={254}
                disabled={readOnly}
                placeholder="e.g. help@myorganization.org"
                onChange={(e) => setSettings({ ...settings, helpContactEmail: e.target.value })}
              />
              <p className="text-xs text-on-surface-variant mt-1">Shown to users who need support. Leave blank to hide.</p>
            </div>
          </div>

          {/* AI master toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-on-surface">Enable AI</h3>
              <p className="text-sm text-on-surface-variant">Master switch for server-side AI. Turn on individual products below.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.aiEnabled}
                disabled={readOnly}
                onChange={(e) => {
                  const on = e.target.checked;
                  setSettings((prev) => ({
                    ...prev,
                    aiEnabled: on,
                    ...(on ? { aiAutoTagEnabled: true, aiSummarizeEnabled: true } : {}),
                  }));
                }}
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
            <h3 className="font-bold text-on-surface">Project record</h3>
            <p className="text-xs text-on-surface-variant -mt-2 mb-1">Inline tools on the project detail view.</p>
            {[
              { key: 'aiAutoTagEnabled', title: 'Auto-tag from project context', desc: 'Show the Auto-Tag control next to tags when you have edit access.' },
              { key: 'aiSummarizeEnabled', title: 'AI executive summary', desc: 'Show AI Summarize next to the executive summary field.' },
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

          <div className={`transition-opacity space-y-4 ${settings.aiEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'} ${readOnly ? 'pointer-events-none' : ''}`}>
            <h3 className="font-bold text-on-surface">Decision support drafts</h3>
            <p className="text-xs text-on-surface-variant -mt-2 mb-1">Buttons under AI Decision Support Workflow on the project record.</p>
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

          {/* Google Workspace Integrations */}
          <div className="space-y-6 pt-2">
            <div>
              <h3 className="font-bold text-on-surface flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-primary" />
                Google Workspace integrations
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Connect a Google Calendar for automated project dates and a Shared Google Drive for file management. These
                integrations use the Firebase service account below, which must be added as a member of the calendar and drive.
              </p>
              {serviceAccountEmail ? (
                <div className="mt-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-xs text-on-surface-variant">
                  <div className="font-bold text-on-surface">Service account email</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="break-all">{serviceAccountEmail}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(serviceAccountEmail);
                        setToast({ type: 'success', message: 'Service account email copied.' });
                      }}
                      className="text-xs font-bold text-primary"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-2">
                    Share your Google Calendar with this email (Make changes to events) and add it as a Manager on the
                    target Shared Drive or folder.
                  </p>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-error/30 bg-error-container/20 p-3 text-xs text-error">
                  Service account not detected. Configure <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> on the server so the
                  Calendar and Drive APIs can be called.
                </div>
              )}
            </div>

            {/* Calendar */}
            <div className="rounded-lg border border-outline-variant/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="font-bold text-on-surface">Google Calendar</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">
                    When enabled, project due dates can be pushed to the configured calendar as events.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.googleCalendarEnabled === true}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, googleCalendarEnabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-calendar-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Calendar ID
                  </label>
                  <input
                    id="settings-calendar-id"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleCalendarId ?? ''}
                    maxLength={254}
                    disabled={readOnly}
                    placeholder="e.g. library-projects@group.calendar.google.com"
                    onChange={(e) => setSettings({ ...settings, googleCalendarId: e.target.value })}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">
                    Found in Calendar settings under <em>Integrate calendar → Calendar ID</em>.
                  </p>
                </div>
                <div>
                  <label htmlFor="settings-calendar-url" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Calendar share link (optional)
                  </label>
                  <input
                    id="settings-calendar-url"
                    type="url"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleCalendarUrl ?? ''}
                    maxLength={500}
                    disabled={readOnly}
                    placeholder="https://calendar.google.com/calendar/u/0/r?cid=..."
                    onChange={(e) => setSettings({ ...settings, googleCalendarUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="settings-calendar-tz" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Timezone (optional)
                  </label>
                  <input
                    id="settings-calendar-tz"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleCalendarTimezone ?? ''}
                    maxLength={64}
                    disabled={readOnly}
                    placeholder="America/Los_Angeles"
                    onChange={(e) => setSettings({ ...settings, googleCalendarTimezone: e.target.value })}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">IANA zone; leave blank to use the calendar default.</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={runCalendarTest}
                  disabled={testingCalendar || !settings.googleCalendarId}
                  className="px-3 py-2 text-xs font-bold rounded-lg border border-primary text-primary disabled:opacity-50"
                >
                  {testingCalendar ? 'Testing...' : 'Test connection'}
                </button>
                <button
                  type="button"
                  onClick={runCalendarSync}
                  disabled={syncingCalendar || readOnly || !settings.googleCalendarEnabled || !settings.googleCalendarId}
                  className="px-3 py-2 text-xs font-bold rounded-lg bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {syncingCalendar ? 'Syncing project dates...' : 'Sync project dates to calendar'}
                </button>
                {settings.googleCalendarUrl && (
                  <a
                    href={settings.googleCalendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-xs font-bold text-primary underline"
                  >
                    Open calendar
                  </a>
                )}
              </div>

              {calendarSyncReport && (
                <div className="mt-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-xs text-on-surface-variant">
                  <div className="font-bold text-on-surface">Last sync report</div>
                  <div className="mt-1">
                    Evaluated {calendarSyncReport.totals.evaluated} · Created {calendarSyncReport.totals.created} ·
                    Updated {calendarSyncReport.totals.updated} · Skipped {calendarSyncReport.totals.skipped} ·
                    Failed {calendarSyncReport.totals.failed}
                  </div>
                  {calendarSyncReport.totals.failed > 0 && (
                    <ul className="mt-2 space-y-1">
                      {calendarSyncReport.outcomes.filter((o) => o.action === 'failed').slice(0, 5).map((o) => (
                        <li key={o.projectId} className="text-error">
                          {o.code || o.projectId}: {o.message || 'failed'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Drive */}
            <div className="rounded-lg border border-outline-variant/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-primary" />
                    <span className="font-bold text-on-surface">Shared Google Drive</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Connect a Shared Drive so admins can list, upload, update, and delete files from this app.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.googleDriveEnabled === true}
                    disabled={readOnly}
                    onChange={(e) => setSettings({ ...settings, googleDriveEnabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-drive-id" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Shared Drive ID
                  </label>
                  <input
                    id="settings-drive-id"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm font-mono"
                    value={settings.googleDriveId ?? ''}
                    maxLength={100}
                    disabled={readOnly}
                    placeholder="0ABCDEFgHijKlmNopQ"
                    onChange={(e) => setSettings({ ...settings, googleDriveId: e.target.value })}
                  />
                  <p className="text-xs text-on-surface-variant mt-1">
                    Open the Shared Drive in the web; the ID is the URL segment after <code>/drive/folders/</code>.
                  </p>
                </div>
                <div>
                  <label htmlFor="settings-drive-url" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Drive share link (optional)
                  </label>
                  <input
                    id="settings-drive-url"
                    type="url"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm"
                    value={settings.googleDriveUrl ?? ''}
                    maxLength={500}
                    disabled={readOnly}
                    placeholder="https://drive.google.com/drive/folders/..."
                    onChange={(e) => setSettings({ ...settings, googleDriveUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="settings-drive-folder" className="block text-xs font-bold text-on-surface-variant uppercase mb-2">
                    Default folder ID (optional)
                  </label>
                  <input
                    id="settings-drive-folder"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg p-2 text-sm font-mono"
                    value={settings.googleDriveFolderId ?? ''}
                    maxLength={100}
                    disabled={readOnly}
                    placeholder="Folder ID for uploads (defaults to drive root)"
                    onChange={(e) => setSettings({ ...settings, googleDriveFolderId: e.target.value })}
                  />
                </div>
              </div>

              {settings.googleDriveUrl && (
                <a
                  href={settings.googleDriveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-3 py-2 text-xs font-bold text-primary underline"
                >
                  Open shared drive
                </a>
              )}

              <p className="text-xs text-on-surface-variant">
                Files can be managed programmatically via <code>GET/POST/PUT/DELETE /api/admin/drive/files</code>.
              </p>
            </div>
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
