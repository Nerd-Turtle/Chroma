import type { AuthSessionResponse } from "../api/chromaApi";

type DashboardPageProps = {
  user: AuthSessionResponse["user"];
};

const DashboardPage = ({ user }: DashboardPageProps) => {
  return (
    <div className="page-panel">
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>Chroma is ready.</p>
        </div>
        <div className="dashboard-user">Signed in as <strong>{user.username}</strong></div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h2>Welcome</h2>
          <p>Your Chroma installation is configured and ready to manage Bedrock instances.</p>
        </div>
        <div className="dashboard-card muted">
          <h2>Coming soon</h2>
          <p>Instances, addons, and settings will appear here in future milestones.</p>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
