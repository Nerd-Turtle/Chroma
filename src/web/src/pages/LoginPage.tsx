import { useState, type FormEvent } from "react";
import { login } from "../api/chromaApi";

type LoginPageProps = {
  onLoginSuccess: (user: { username: string; role: string }) => void;
};

const LoginPage = ({ onLoginSuccess }: LoginPageProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const response = await login({ username, password });
    if (response?.authenticated && response.user) {
      onLoginSuccess(response.user);
    } else {
      setError(response?.error || "Invalid username or password");
    }
  };

  return (
    <div className="page-panel">
      <h1>Sign in</h1>
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
        <button type="submit" className="primary-button">Sign in</button>
      </form>
    </div>
  );
};

export default LoginPage;
