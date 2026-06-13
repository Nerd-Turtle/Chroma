import { useEffect, useState } from "react";
import type { AuthUser, DashboardSummary } from "../../../shared/types/index.js";
import { getDashboardSummary } from "../api/chromaApi.js";

type DashboardPageProps = {
  user: AuthUser;
};

const DashboardPage = ({ user }: DashboardPageProps) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSummary() {
      try {
        setSummary(await getDashboardSummary());
      } catch (summaryError) {
        setError(summaryError instanceof Error ? summaryError.message : "Unable to load dashboard");
      }
    }

    void loadSummary();
  }, []);

  return (
    <section className="dashboard-layout">
      <div className="page-panel hero-panel">
        <p className="eyebrow">Dashboard</p>
        <h1>Chroma is ready.</h1>
        <p className="lead">
          This shell keeps the first milestone small while the instance and addon screens are still being built.
        </p>
        <div className="status-row">
          <span className="status-chip">Signed in as {user.username}</span>
          <span className="status-chip subtle">Role: {user.role}</span>
        </div>
      </div>

      {error ? <div className="page-panel form-error">{error}</div> : null}

      <div className="dashboard-grid">
        <article className="page-panel stat-card">
          <h2>Instances</h2>
          <strong>{summary?.instanceCount ?? "..."}</strong>
          <p>Total managed instances</p>
        </article>

        <article className="page-panel stat-card">
          <h2>Running</h2>
          <strong>{summary?.runningInstanceCount ?? "..."}</strong>
          <p>Currently active Bedrock servers</p>
        </article>

        <article className="page-panel stat-card">
          <h2>Stopped</h2>
          <strong>{summary?.stoppedInstanceCount ?? "..."}</strong>
          <p>Instances available to start</p>
        </article>

        <article className="page-panel stat-card">
          <h2>Application settings</h2>
          <strong>{summary?.appSettings?.timezone ?? "Pending"}</strong>
          <p>{summary?.appSettings?.language ?? "Language not set"}</p>
        </article>
      </div>
    </section>
  );
};

export default DashboardPage;
