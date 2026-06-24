import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppSettings, UpdateAppSettingsRequest } from "../../../shared/types/index.js";
import { getAppSettings, updateAppSettings } from "../api/chromaApi.js";

function getTimezoneOptions(): string[] {
  if (typeof Intl.supportedValuesOf !== "function") {
    return ["UTC"];
  }

  return Intl.supportedValuesOf("timeZone");
}

const SettingsPage = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [timezone, setTimezone] = useState("");
  const [timezoneQuery, setTimezoneQuery] = useState("");
  const [showTimezoneOptions, setShowTimezoneOptions] = useState(false);
  const [language, setLanguage] = useState("");
  const [notificationDurationSeconds, setNotificationDurationSeconds] = useState("2");
  const [curseForgeApiKey, setCurseForgeApiKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  const filteredTimezoneOptions = useMemo(() => {
    const normalizedQuery = timezoneQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return timezoneOptions.slice(0, 12);
    }

    return timezoneOptions
      .filter((option) => option.toLowerCase().includes(normalizedQuery))
      .slice(0, 12);
  }, [timezoneOptions, timezoneQuery]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const result = await getAppSettings();
        setSettings(result.settings);
        setTimezone(result.settings.timezone);
        setTimezoneQuery(result.settings.timezone);
        setLanguage(result.settings.language);
        setNotificationDurationSeconds(String(result.settings.notificationDurationSeconds));
      } catch (settingsError) {
        setError(settingsError instanceof Error ? settingsError.message : "Unable to load settings");
      } finally {
        setLoading(false);
      }
    }

    void loadSettings();
  }, []);

  useEffect(() => {
    if (!success) {
      return;
    }

    const parsedSeconds = Number.parseInt(notificationDurationSeconds, 10);
    const durationMs = Number.isInteger(parsedSeconds) && parsedSeconds >= 1 ? parsedSeconds * 1000 : 2000;
    const timeoutId = window.setTimeout(() => {
      setSuccess("");
    }, durationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [success, notificationDurationSeconds]);

  async function saveSettings(payload: UpdateAppSettingsRequest, message: string): Promise<void> {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result = await updateAppSettings(payload);
      setSettings(result.settings);
      setTimezone(result.settings.timezone);
      setTimezoneQuery(result.settings.timezone);
      setLanguage(result.settings.language);
      setNotificationDurationSeconds(String(result.settings.notificationDurationSeconds));
      setCurseForgeApiKey("");
      setSuccess(message);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!timezoneOptions.includes(timezone)) {
      setError("Select a valid timezone from the list");
      return;
    }

    const payload: UpdateAppSettingsRequest = {
      timezone: timezone.trim(),
      language: language.trim(),
      notificationDurationSeconds: Number.parseInt(notificationDurationSeconds, 10),
      ...(curseForgeApiKey.trim() ? { curseForgeApiKey: curseForgeApiKey.trim() } : {}),
    };

    await saveSettings(payload, "Application settings saved.");
  };

  const handleRemoveCurseForgeKey = async () => {
    if (!settings || saving) {
      return;
    }

    await saveSettings(
      {
        timezone: timezone.trim(),
        language: language.trim(),
        notificationDurationSeconds: Number.parseInt(notificationDurationSeconds, 10),
        clearCurseForgeApiKey: true,
      },
      "CurseForge API key removed.",
    );
  };

  return (
    <section className="dashboard-layout">
      <div className="page-panel hero-panel">
        <p className="eyebrow">Settings</p>
        <h1>Application settings</h1>
        <p className="lead">Manage local Chroma settings and provider credentials for this install.</p>
      </div>

      <div className="page-panel settings-panel">
        {loading ? <p className="muted-copy">Loading settings...</p> : null}
        {error ? <div className="form-error">{error}</div> : null}
        {success ? <div className="status-banner status-banner-info">{success}</div> : null}

        {!loading ? (
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Timezone
              <div className="combobox">
                <input
                  value={timezoneQuery}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setTimezoneQuery(nextValue);
                    setTimezone(nextValue);
                    setShowTimezoneOptions(true);
                  }}
                  onFocus={() => {
                    setShowTimezoneOptions(true);
                    setTimezoneQuery((currentQuery) => (currentQuery === timezone ? "" : currentQuery));
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setShowTimezoneOptions(false);
                      setTimezoneQuery(timezone);
                    }, 120);
                  }}
                  placeholder="Search timezone"
                  role="combobox"
                  aria-expanded={showTimezoneOptions}
                  aria-autocomplete="list"
                  aria-controls="settings-timezone-options"
                />

                {showTimezoneOptions ? (
                  <div className="combobox-menu" id="settings-timezone-options" role="listbox">
                    {filteredTimezoneOptions.length > 0 ? (
                      filteredTimezoneOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`combobox-option${option === timezone ? " active" : ""}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setTimezone(option);
                            setTimezoneQuery(option);
                            setShowTimezoneOptions(false);
                          }}
                        >
                          {option}
                        </button>
                      ))
                    ) : (
                      <div className="combobox-empty">No matching timezones</div>
                    )}
                  </div>
                ) : null}
              </div>
            </label>

            <label>
              Language
              <input value={language} onChange={(event) => setLanguage(event.target.value)} />
            </label>

            <label>
              Notification duration seconds
              <input
                type="number"
                min={1}
                max={30}
                step={1}
                value={notificationDurationSeconds}
                onChange={(event) => setNotificationDurationSeconds(event.target.value)}
              />
            </label>

            <div className="settings-provider-block">
              <div>
                <h2>CurseForge API</h2>
                <p className="muted-copy">
                  {settings?.curseForgeApiKeyConfigured
                    ? `Configured key ending in ${settings.curseForgeApiKeyLastFour ?? "unknown"}.`
                    : "No API key configured."}
                </p>
              </div>

              <label>
                API key
                <input
                  type="password"
                  value={curseForgeApiKey}
                  onChange={(event) => setCurseForgeApiKey(event.target.value)}
                  maxLength={512}
                  autoComplete="off"
                  placeholder={settings?.curseForgeApiKeyConfigured ? "Leave blank to keep current key" : "Optional"}
                />
              </label>

              {settings?.curseForgeApiKeyConfigured ? (
                <button
                  type="button"
                  className="secondary-button settings-inline-action"
                  onClick={() => void handleRemoveCurseForgeKey()}
                  disabled={saving}
                >
                  Remove CurseForge key
                </button>
              ) : null}
            </div>

            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
};

export default SettingsPage;
