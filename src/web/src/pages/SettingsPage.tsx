import { useEffect, useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
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
  const [organization, setOrganization] = useState("");
  const [organizationalUnit, setOrganizationalUnit] = useState("");
  const [country, setCountry] = useState("");
  const [stateOrProvince, setStateOrProvince] = useState("");
  const [locality, setLocality] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateDrawer, setCertificateDrawer] = useState<"csr" | "install" | null>(null);

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

  useEffect(() => {
    if (!certificateDrawer) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pkiBusy) {
        setCertificateDrawer(null);
        setCertificateFile(null);
        setPkiError("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [certificateDrawer, pkiBusy]);

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
        ...(organization.trim() ? { organization: organization.trim() } : {}),
        ...(organizationalUnit.trim() ? { organizationalUnit: organizationalUnit.trim() } : {}),
        ...(country.trim() ? { country: country.trim() } : {}),
        ...(stateOrProvince.trim() ? { stateOrProvince: stateOrProvince.trim() } : {}),
        ...(locality.trim() ? { locality: locality.trim() } : {}),
      });
      const url = URL.createObjectURL(new Blob([result.csrPem], { type: "application/pkcs10" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setPkiStatus((current) => current ? {
        ...current,
        privateKeyAvailable: true,
        certificateSigningRequestAvailable: true,
      } : current);
      setPkiSuccess("CSR generated. Send the downloaded file to your certificate authority.");
      setCertificateDrawer(null);
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
      setCertificateDrawer(null);
    } catch (certificateError) {
      setPkiError(certificateError instanceof Error ? certificateError.message : "Unable to install certificate");
    } finally {
      setPkiBusy(false);
    }
  };

  const openCertificateDrawer = (drawer: "csr" | "install") => {
    setPkiError("");
    setPkiSuccess("");
    setCertificateFile(null);
    setCertificateDrawer(drawer);
  };

  const closeCertificateDrawer = () => {
    if (pkiBusy) return;
    setCertificateDrawer(null);
    setCertificateFile(null);
    setPkiError("");
  };

  const formatCertificateDate = (value: string | undefined) => {
    if (!value) return "—";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  };

  const certificateIdentityBroken = Boolean(
    pkiStatus?.certificate.configured && !pkiStatus.privateKeyAvailable,
  );
  const canCreateCsr = Boolean(!pkiLoading && pkiStatus && !certificateIdentityBroken);
  const canInstallCertificate = Boolean(!pkiLoading && pkiStatus?.privateKeyAvailable);

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
          <div className="certificate-header-actions">
            {pkiStatus?.certificate.configured ? (
              <span className={`certificate-badge${pkiStatus.certificate.selfSigned ? " certificate-badge-warning" : ""}`}>
                {pkiStatus.certificate.selfSigned ? "Self-signed" : "Custom certificate"}
              </span>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={!canCreateCsr}
              title={certificateIdentityBroken ? "The existing certificate's private key is unavailable" : undefined}
              onClick={() => openCertificateDrawer("csr")}
            >
              Create CSR
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canInstallCertificate}
              title={!pkiLoading && !pkiStatus?.privateKeyAvailable ? "Create a CSR to initialize the TLS private key first" : undefined}
              onClick={() => openCertificateDrawer("install")}
            >
              Install certificate
            </button>
          </div>
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

            {certificateIdentityBroken ? (
              <div className="form-error">The TLS private key is missing. Repair the installation before managing certificates.</div>
            ) : !pkiStatus.privateKeyAvailable ? (
              <div className="status-banner status-banner-info">No TLS identity has been initialized. Creating a CSR will securely create the managed private key.</div>
            ) : null}
          </>
        ) : null}
      </section>

      {certificateDrawer ? (
        <div className="settings-drawer-layer">
          <button
            type="button"
            className="settings-drawer-backdrop"
            aria-label="Close certificate drawer"
            onClick={closeCertificateDrawer}
          />
          <aside
            className="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="certificate-drawer-title"
          >
            <header className="settings-drawer-header">
              <div>
                <p className="eyebrow">HTTPS Certificate</p>
                <h2 id="certificate-drawer-title">
                  {certificateDrawer === "csr" ? "Create certificate signing request" : "Install signed certificate"}
                </h2>
              </div>
              <button
                type="button"
                className="settings-drawer-close"
                aria-label="Close certificate drawer"
                disabled={pkiBusy}
                onClick={closeCertificateDrawer}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            {certificateDrawer === "csr" ? (
              <form className="form-grid settings-drawer-form" onSubmit={handleGenerateCsr}>
                <div className="settings-drawer-fields">
                  <p className="muted-copy">
                    {pkiStatus?.privateKeyAvailable
                      ? "The installer-managed private key stays on this server. Add every name people use to reach Chroma."
                      : "Chroma will create a managed private key that stays on this server. Add every name people use to reach Chroma."}
                  </p>
                  {pkiError ? <div className="form-error">{pkiError}</div> : null}

                  <label>
                    Common name
                    <input autoFocus value={commonName} onChange={(event) => setCommonName(event.target.value)} required />
                  </label>
                  <label>
                    SAN DNS names
                    <textarea value={dnsNames} onChange={(event) => setDnsNames(event.target.value)} rows={4} placeholder="chroma.example.com" />
                    <small className="muted-copy">One hostname per line or separated by commas. Wildcards are supported in the first label.</small>
                  </label>
                  <label>
                    SAN IP addresses
                    <textarea value={ipAddresses} onChange={(event) => setIpAddresses(event.target.value)} rows={3} placeholder="192.0.2.10" />
                    <small className="muted-copy">Optional; IPv4 and IPv6 are supported.</small>
                  </label>

                  <fieldset className="certificate-subject-fields">
                    <legend>Optional subject information</legend>
                    <label>Organization<input value={organization} onChange={(event) => setOrganization(event.target.value)} maxLength={128} /></label>
                    <label>Organizational unit<input value={organizationalUnit} onChange={(event) => setOrganizationalUnit(event.target.value)} maxLength={128} /></label>
                    <div className="certificate-subject-row">
                      <label>Country<input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} maxLength={2} placeholder="US" /></label>
                      <label>State or province<input value={stateOrProvince} onChange={(event) => setStateOrProvince(event.target.value)} maxLength={128} /></label>
                    </div>
                    <label>City or locality<input value={locality} onChange={(event) => setLocality(event.target.value)} maxLength={128} /></label>
                  </fieldset>

                  <div className="certificate-fixed-options" aria-label="Certificate request defaults">
                    <div><span>Private key</span><strong>{pkiStatus?.privateKeyAvailable ? "Existing managed key" : "New managed RSA 3072-bit key"}</strong></div>
                    <div><span>Signature</span><strong>SHA-256</strong></div>
                    <div><span>Usage</span><strong>TLS server authentication</strong></div>
                  </div>
                </div>

                <footer className="settings-drawer-footer">
                  <button type="submit" className="primary-button" disabled={pkiBusy}>
                    {pkiBusy ? "Generating..." : "Generate and download CSR"}
                  </button>
                  <button type="button" className="secondary-button" disabled={pkiBusy} onClick={closeCertificateDrawer}>Cancel</button>
                </footer>
              </form>
            ) : (
              <div className="form-grid settings-drawer-form">
                <div className="settings-drawer-fields">
                  <p className="muted-copy">Upload the PEM returned by your certificate authority. Place the server certificate first, followed by any intermediate certificates.</p>
                  {pkiError ? <div className="form-error">{pkiError}</div> : null}
                  <label>
                    Signed certificate chain
                    <input
                      autoFocus
                      type="file"
                      accept=".pem,.crt,.cer,application/x-pem-file,application/pkix-cert"
                      onChange={(event) => setCertificateFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <p className="muted-copy certificate-safety-copy">
                    Chroma validates the certificate against its private key and backs up the current certificate before activation.
                  </p>
                </div>

                <footer className="settings-drawer-footer">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={pkiBusy || !certificateFile}
                    onClick={() => void handleInstallCertificate()}
                  >
                    {pkiBusy ? "Installing..." : "Validate and install"}
                  </button>
                  <button type="button" className="secondary-button" disabled={pkiBusy} onClick={closeCertificateDrawer}>Cancel</button>
                </footer>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
};

export default SettingsPage;
