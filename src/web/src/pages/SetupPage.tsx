import { useEffect, useState, type FormEvent } from "react";
import { completeSetup } from "../api/chromaApi";

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

  useEffect(() => {
    if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    }
    if (typeof navigator !== "undefined") {
      setLanguage(navigator.language || "en-US");
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (username.trim().length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    const response = await completeSetup({
      username: username.trim(),
      password,
      timezone,
      language,
    });

    if (response?.success) {
      onSetupComplete();
    } else {
      setError(response?.error || "Unable to complete setup");
    }
  };

  return (
    <div className="page-panel">
      <h1>Setup Chroma</h1>
      <p>Complete initial setup for your local Chroma installation.</p>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>

        <label>
          Confirm password
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
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
        <button type="submit" className="primary-button">Complete Setup</button>
      </form>
    </div>
  );
};

export default SetupPage;
