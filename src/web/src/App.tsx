import { useEffect, useState } from "react";
import type { AuthUser } from "../../shared/types/index.js";
import { getSession, getSetupStatus, logout } from "./api/chromaApi.js";
import TopNav from "./components/TopNav.js";
import DashboardPage from "./pages/DashboardPage.js";
import LoginPage from "./pages/LoginPage.js";
import SetupPage from "./pages/SetupPage.js";

type AppPage = "setup" | "login" | "dashboard";

const App = () => {
  const [page, setPage] = useState<AppPage>("login");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function initializeApp() {
      const setupStatus = await getSetupStatus();
      if (setupStatus.setupRequired) {
        setPage("setup");
        setLoading(false);
        return;
      }

      const session = await getSession();
      if (session.authenticated) {
        setUser(session.user);
        setPage("dashboard");
      } else {
        setPage("login");
      }

      setLoading(false);
    }

    void initializeApp();
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setPage("login");
  };

  const isAuthenticated = page === "dashboard" && user !== null;

  return (
    <div className="app-shell">
      <TopNav authenticated={isAuthenticated} activePage={page} user={user} onLogout={() => void handleLogout()} />

      <main className="page-frame">
        {loading ? <section className="page-panel">Loading Chroma...</section> : null}
        {!loading && page === "setup" ? <SetupPage onSetupComplete={() => setPage("login")} /> : null}
        {!loading && page === "login" ? <LoginPage onLoginSuccess={(nextUser: AuthUser) => {
          setUser(nextUser);
          setPage("dashboard");
        }} /> : null}
        {!loading && page === "dashboard" && user ? <DashboardPage user={user} /> : null}
      </main>
    </div>
  );
};

export default App;
