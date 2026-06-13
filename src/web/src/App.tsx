import { useEffect, useState } from "react";
import { getSetupStatus, getAuthSession, logout } from "./api/chromaApi";
import TopNav from "./components/TopNav";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";

const App = () => {
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [page, setPage] = useState<"setup" | "login" | "dashboard">("dashboard");

  useEffect(() => {
    async function init() {
      const setup = await getSetupStatus();
      if (setup.setupRequired) {
        setSetupRequired(true);
        setPage("setup");
        setLoading(false);
        return;
      }

      setSetupRequired(false);
      const session = await getAuthSession();
      if (!session.authenticated) {
        setAuthenticated(false);
        setPage("login");
      } else {
        setAuthenticated(true);
        setUser(session.user);
        setPage("dashboard");
      }

      setLoading(false);
    }

    init();
  }, []);

  const handleAuthenticated = (userInfo: { username: string; role: string }) => {
    setAuthenticated(true);
    setUser(userInfo);
    setPage("dashboard");
  };

  const handleLogout = async () => {
    await logout();
    setAuthenticated(false);
    setUser(null);
    setPage("login");
  };

  if (loading) {
    return <div className="app-shell">Loading…</div>;
  }

  return (
    <div className="app-shell">
      <TopNav
        activePage={page}
        authenticated={authenticated}
        user={user}
        onNavigate={(target) => setPage(target)}
        onLogout={handleLogout}
      />
      <main className="page-content">
        {page === "setup" && <SetupPage onSetupComplete={() => setPage("login")} />}
        {page === "login" && <LoginPage onLoginSuccess={handleAuthenticated} />}
        {page === "dashboard" && authenticated && user && <DashboardPage user={user} />}
      </main>
    </div>
  );
};

export default App;
