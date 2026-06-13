import { useEffect, useState, type FormEvent } from "react";
import { completeSetup } from "../api/chromaApi.js";

type SetupPageProps = {
  onSetupComplete: () => void;
};

const SetupPage = ({ onSetupComplete }: SetupPageProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [timezone, setTimezone] = useState("");
  const [language, setLanguage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setLanguage(navigator.language || "en-US");
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords do not match");
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
      });
      onSetupComplete();
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-panel">
      <p className="eyebrow">Milestone 1.0</p>
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
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </label>

        <label>
          Language
          <input value={language} onChange={(event) => setLanguage(event.target.value)} />
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
