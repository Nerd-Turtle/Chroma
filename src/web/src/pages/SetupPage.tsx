import { useEffect, useMemo, useState, type FormEvent } from "react";
import { completeSetup } from "../api/chromaApi.js";

type SetupPageProps = {
  onSetupComplete: () => void;
};

const SetupPage = ({ onSetupComplete }: SetupPageProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [timezone, setTimezone] = useState("");
  const [timezoneQuery, setTimezoneQuery] = useState("");
  const [showTimezoneOptions, setShowTimezoneOptions] = useState(false);
  const [language, setLanguage] = useState("");
  const [curseForgeApiKey, setCurseForgeApiKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const timezoneOptions = useMemo(() => {
    if (typeof Intl.supportedValuesOf !== "function") {
      return ["UTC"];
    }

    return Intl.supportedValuesOf("timeZone");
  }, []);

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
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimezone(detectedTimezone);
    setTimezoneQuery(detectedTimezone);
    setLanguage(navigator.language || "en-US");
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!timezoneOptions.includes(timezone)) {
      setError("Select a valid timezone from the list");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await completeSetup({
        username: username.trim(),
        password,
        timezone: timezone.trim(),
        language: language.trim(),
        ...(curseForgeApiKey.trim() ? { curseForgeApiKey: curseForgeApiKey.trim() } : {}),
      });
      onSetupComplete();
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-panel setup-panel">
      <h1>Set up Chroma</h1>
      <p className="lead">
        Create the local admin account and store the basic application settings needed for this install.
      </p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} />
        </label>

        <label>
          Confirm password
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} />
        </label>

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
              aria-controls="timezone-options"
            />

            {showTimezoneOptions ? (
              <div className="combobox-menu" id="timezone-options" role="listbox">
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
          CurseForge API key
          <input
            type="password"
            value={curseForgeApiKey}
            onChange={(event) => setCurseForgeApiKey(event.target.value)}
            maxLength={512}
            autoComplete="off"
            placeholder="Optional"
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Completing setup..." : "Complete setup"}
        </button>
      </form>
    </section>
  );
};

export default SetupPage;
