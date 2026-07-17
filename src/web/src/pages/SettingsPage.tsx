import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppSettings, PkiStatusResponse, UpdateAppSettingsRequest } from "../../../shared/types/index.js";
import {
  generatePkiCsr,
  getAppSettings,
  getPkiStatus,
  installPkiCertificate,
  updateAppSettings,
} from "../api/chromaApi.js";

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
  const [pkiStatus, setPkiStatus] = useState<PkiStatusResponse | null>(null);
  const [pkiLoading, setPkiLoading] = useState(true);
  const [pkiBusy, setPkiBusy] = useState(false);
  const [pkiError, setPkiError] = useState("");
  const [pkiSuccess, setPkiSuccess] = useState("");
  const [commonName, setCommonName] = useState(() => window.location.hostname || "chroma.local");
  const [dnsNames, setDnsNames] = useState(() => window.location.hostname || "chroma.local");
  const [ipAddresses, setIpAddresses] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);

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
    async function loadPkiStatus() {
      try {
        setPkiStatus(await getPkiStatus());
      } catch (statusError) {
        setPkiError(statusError instanceof Error ? statusError.message : "Unable to load certificate status");
      } finally {
        setPkiLoading(false);
      }
    }

    void loadPkiStatus();
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

  const handleGenerateCsr = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPkiBusy(true);
    setPkiError("");
    setPkiSuccess("");

    try {
      const splitNames = (value: string) => value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
      const result = await generatePkiCsr({
        commonName: commonName.trim(),
        dnsNames: splitNames(dnsNames),
        ipAddresses: splitNames(ipAddresses),
      });
      const url = URL.createObjectURL(new Blob([result.csrPem], { type: "application/pkcs10" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setPkiStatus((current) => current ? { ...current, certificateSigningRequestAvailable: true } : current);
      setPkiSuccess("CSR generated. Send the downloaded file to your certificate authority.");
    } catch (csrError) {
      setPkiError(csrError instanceof Error ? csrError.message : "Unable to generate CSR");
    } finally {
      setPkiBusy(false);
    }
  };

  const handleInstallCertificate = async () => {
    if (!certificateFile) return;

    setPkiBusy(true);
    setPkiError("");
    setPkiSuccess("");
    try {
      if (certificateFile.size > 128 * 1024) {
        throw new Error("The certificate chain must be 128 KiB or smaller");
      }
      const result = await installPkiCertificate(await certificateFile.text());
      setPkiStatus(result);
      setCertificateFile(null);
      setPkiSuccess(
        result.reloaded
          ? "Certificate installed and activated. New HTTPS connections now use it."
          : "Certificate installed. It will be used the next time Chroma starts with HTTPS enabled.",
      );
    } catch (certificateError) {
      setPkiError(certificateError instanceof Error ? certificateError.message : "Unable to install certificate");
    } finally {
      setPkiBusy(false);
    }
  };

  const formatCertificateDate = (value: string | undefined) => {
    if (!value) return "—";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  };

  return (
    <section className="settings-layout">
      <header className="settings-page-header">
        <div>
          <h1>Settings</h1>
          <p className="lead">Manage local Chroma settings and provider credentials for this install.</p>
        </div>
        {!loading ? (
          <button type="submit" form="application-settings-form" className="primary-button" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        ) : null}
      </header>

      {loading ? <p className="muted-copy">Loading settings...</p> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="status-banner status-banner-info">{success}</div> : null}

      {!loading ? (
        <form id="application-settings-form" className="form-grid settings-form" onSubmit={handleSubmit}>
          <div className="settings-columns">
            <section className="settings-section">
              <header className="settings-section-header">
                <h2>Application Settings</h2>
                <p className="muted-copy">Configure Chroma's local display and notification preferences.</p>
              </header>

              <div className="settings-fields">
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
              </div>
            </section>

            <section className="settings-section settings-api-section">
              <header className="settings-section-header">
                <h2>API Settings</h2>
                <p className="muted-copy">Manage credentials for services connected to Chroma.</p>
              </header>

              <div className="settings-provider-block">
                <div className="settings-provider-heading">
                  <h3>CurseForge</h3>
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
            </section>
          </div>

        </form>
      ) : null}

      <section className="settings-section settings-certificate-section">
        <header className="settings-section-header settings-certificate-header">
          <div>
            <h2>HTTPS Certificate</h2>
            <p className="muted-copy">Replace the installer-created self-signed certificate without exposing its private key.</p>
          </div>
          {pkiStatus?.certificate.configured ? (
            <span className={`certificate-badge${pkiStatus.certificate.selfSigned ? " certificate-badge-warning" : ""}`}>
              {pkiStatus.certificate.selfSigned ? "Self-signed" : "Custom certificate"}
            </span>
          ) : null}
        </header>

        {pkiLoading ? <p className="muted-copy">Loading certificate status...</p> : null}
        {pkiError ? <div className="form-error">{pkiError}</div> : null}
        {pkiSuccess ? <div className="status-banner status-banner-info">{pkiSuccess}</div> : null}

        {!pkiLoading && pkiStatus ? (
          <>
            <dl className="certificate-summary">
              <div><dt>Common name</dt><dd>{pkiStatus.certificate.commonName ?? "Not configured"}</dd></div>
              <div><dt>Valid until</dt><dd>{formatCertificateDate(pkiStatus.certificate.validTo)}</dd></div>
              <div><dt>HTTPS</dt><dd>{pkiStatus.certificate.tlsEnabled ? "Enabled" : "Disabled in this runtime"}</dd></div>
              <div><dt>SHA-256 fingerprint</dt><dd className="certificate-fingerprint">{pkiStatus.certificate.fingerprintSha256 ?? "—"}</dd></div>
            </dl>

            {!pkiStatus.privateKeyAvailable ? (
              <div className="form-error">The TLS private key is missing. Repair the installation before managing certificates.</div>
            ) : (
              <div className="certificate-workflow">
                <form className="form-grid certificate-workflow-step" onSubmit={handleGenerateCsr}>
                  <div className="certificate-step-heading">
                    <span>1</span>
                    <div>
                      <h3>Generate a CSR</h3>
                      <p className="muted-copy">Add every hostname or IP address people will use to open Chroma.</p>
                    </div>
                  </div>

                  <label>
                    Common name
                    <input value={commonName} onChange={(event) => setCommonName(event.target.value)} required />
                  </label>
                  <label>
                    DNS names
                    <textarea value={dnsNames} onChange={(event) => setDnsNames(event.target.value)} rows={3} placeholder="chroma.example.com" />
                    <small className="muted-copy">One per line or separated by commas.</small>
                  </label>
                  <label>
                    IP addresses
                    <textarea value={ipAddresses} onChange={(event) => setIpAddresses(event.target.value)} rows={2} placeholder="192.0.2.10" />
                    <small className="muted-copy">Optional; one per line or separated by commas.</small>
                  </label>
                  <button type="submit" className="secondary-button settings-inline-action" disabled={pkiBusy}>
                    {pkiBusy ? "Working..." : "Generate and download CSR"}
                  </button>
                </form>

                <div className="form-grid certificate-workflow-step">
                  <div className="certificate-step-heading">
                    <span>2</span>
                    <div>
                      <h3>Upload the signed certificate</h3>
                      <p className="muted-copy">Upload the PEM returned by your certificate authority, with the server certificate first followed by any intermediate certificates.</p>
                    </div>
                  </div>

                  <label>
                    Signed certificate chain
                    <input
                      type="file"
                      accept=".pem,.crt,.cer,application/x-pem-file,application/pkix-cert"
                      onChange={(event) => setCertificateFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button settings-inline-action"
                    disabled={pkiBusy || !certificateFile}
                    onClick={() => void handleInstallCertificate()}
                  >
                    {pkiBusy ? "Working..." : "Validate and install certificate"}
                  </button>
                  <p className="muted-copy certificate-safety-copy">
                    Chroma verifies the certificate against its private key and keeps a backup of the current certificate before activation.
                  </p>
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>
    </section>
  );
};

export default SettingsPage;
