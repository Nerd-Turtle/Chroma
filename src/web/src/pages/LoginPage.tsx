import { useState, type FormEvent } from "react";
import type { AuthUser } from "../../../shared/types/index.js";
import { login } from "../api/chromaApi.js";

type LoginPageProps = {
  onLoginSuccess: (user: AuthUser) => void;
};

const LoginPage = ({ onLoginSuccess }: LoginPageProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const result = await login({
        username: username.trim(),
        password,
      });
      onLoginSuccess(result.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-panel setup-panel">
      <h1>Sign in to Chroma</h1>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>

        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>

        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
};

export default LoginPage;
