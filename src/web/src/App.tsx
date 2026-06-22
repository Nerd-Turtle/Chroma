import { useEffect, useState } from "react";
import type { AuthUser } from "../../shared/types/index.js";
import { getSession, getSetupStatus, logout } from "./api/chromaApi.js";
import TopNav from "./components/TopNav.js";
import DashboardPage from "./pages/DashboardPage.js";
import InstancesPage from "./pages/InstancesPage.js";
import LoginPage from "./pages/LoginPage.js";
import SetupPage from "./pages/SetupPage.js";
import SettingsPage from "./pages/SettingsPage.js";

type AppPage = "setup" | "login" | "dashboard" | "instances" | "settings";

function getWorkspacePageFromHash(): "dashboard" | "instances" | "settings" | null {
  const hash = window.location.hash.replace(/^#/, "");

  if (hash === "dashboard" || hash === "instances" || hash === "settings") {
    return hash;
  }

  return null;
}

function syncWorkspaceHash(page: "dashboard" | "instances" | "settings"): void {
  const nextHash = `#${page}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

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
        setPage(getWorkspacePageFromHash() ?? "dashboard");
      } else {
        setPage("login");
      }

      setLoading(false);
    }

    void initializeApp();
  }, []);

  useEffect(() => {
    function handleHashChange() {
      if (!user) {
        return;
      }

      const nextPage = getWorkspacePageFromHash();
      if (nextPage) {
        setPage(nextPage);
      }
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [user]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setPage("login");
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  const isAuthenticated = user !== null && page !== "setup" && page !== "login";

  return (
    <div className="app-shell">
      <TopNav
        authenticated={isAuthenticated}
        activePage={page}
        user={user}
        onLogout={() => void handleLogout()}
        onNavigate={(nextPage) => {
          setPage(nextPage);
          syncWorkspaceHash(nextPage);
        }}
      />

      <main className={page === "instances" ? "page-frame page-frame-workspace" : "page-frame"}>
        {loading ? <section className="page-panel">Loading Chroma...</section> : null}
        {!loading && page === "setup" ? <SetupPage onSetupComplete={() => setPage("login")} /> : null}
        {!loading && page === "login" ? <LoginPage onLoginSuccess={(nextUser: AuthUser) => {
          setUser(nextUser);
          setPage("dashboard");
          syncWorkspaceHash("dashboard");
        }} /> : null}
        {!loading && page === "dashboard" && user ? <DashboardPage user={user} /> : null}
        {!loading && page === "instances" && user ? <InstancesPage /> : null}
        {!loading && page === "settings" && user ? <SettingsPage /> : null}
      </main>
    </div>
  );
};

export default App;
