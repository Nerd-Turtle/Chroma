import { useEffect, useState } from "react";
import type { AuthUser } from "../../shared/types/index.js";
import { getSession, getSetupStatus, logout } from "./api/chromaApi.js";
import TopNav from "./components/TopNav.js";
import Tooltip from "./components/Tooltip.js";
import AddonLibraryPage from "./pages/AddonLibraryPage.js";
import DashboardPage from "./pages/DashboardPage.js";
import InstancesPage from "./pages/InstancesPage.js";
import LoginPage from "./pages/LoginPage.js";
import SetupPage from "./pages/SetupPage.js";
import SettingsPage from "./pages/SettingsPage.js";

type AppPage = "setup" | "login" | "dashboard" | "instances" | "addon-library" | "settings";

function getWorkspacePageFromHash(): "dashboard" | "instances" | "addon-library" | "settings" | null {
  const hash = window.location.hash.replace(/^#/, "").split("?", 1)[0] ?? "";

  if (hash === "dashboard" || hash === "instances" || hash === "addon-library" || hash === "settings") {
    return hash;
  }

  return null;
}

function getAddonLibraryQueryFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const [page, queryString = ""] = hash.split("?", 2);
  if (page !== "addon-library") return "";
  return new URLSearchParams(queryString).get("q") ?? "";
}

type AddonLibrarySyncContext = { instanceId: string; addonId: string } | null;

function getAddonLibrarySyncContextFromHash(): AddonLibrarySyncContext {
  const hash = window.location.hash.replace(/^#/, "");
  const [page, queryString = ""] = hash.split("?", 2);
  if (page !== "addon-library") return null;
  const params = new URLSearchParams(queryString);
  const instanceId = params.get("instanceId");
  const addonId = params.get("addonId");
  return instanceId && addonId ? { instanceId, addonId } : null;
}

function syncWorkspaceHash(page: "dashboard" | "instances" | "addon-library" | "settings"): void {
  const nextHash = `#${page}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

const App = () => {
  const [page, setPage] = useState<AppPage>("login");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [addonLibraryQuery, setAddonLibraryQuery] = useState("");
  const [addonLibrarySyncContext, setAddonLibrarySyncContext] = useState<AddonLibrarySyncContext>(null);

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
        setAddonLibraryQuery(getAddonLibraryQueryFromHash());
        setAddonLibrarySyncContext(getAddonLibrarySyncContextFromHash());
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
        setAddonLibraryQuery(getAddonLibraryQueryFromHash());
        setAddonLibrarySyncContext(getAddonLibrarySyncContextFromHash());
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
          setAddonLibraryQuery("");
          setAddonLibrarySyncContext(null);
          syncWorkspaceHash(nextPage);
        }}
      />

      <main
        className={
          page === "instances"
            ? "page-frame page-frame-workspace"
            : page === "addon-library"
              ? "page-frame page-frame-addon-library"
              : page === "dashboard"
                ? "page-frame page-frame-dashboard"
                : "page-frame"
        }
      >
        {loading ? <section className="page-panel">Loading Chroma...</section> : null}
        {!loading && page === "setup" ? <SetupPage onSetupComplete={() => setPage("login")} /> : null}
        {!loading && page === "login" ? <LoginPage onLoginSuccess={(nextUser: AuthUser) => {
          setUser(nextUser);
          setPage("dashboard");
          syncWorkspaceHash("dashboard");
        }} /> : null}
        {!loading && page === "dashboard" && user ? <DashboardPage /> : null}
        {!loading && page === "instances" && user ? <InstancesPage /> : null}
        {!loading && page === "addon-library" && user ? <AddonLibraryPage initialQuery={addonLibraryQuery} syncContext={addonLibrarySyncContext} /> : null}
        {!loading && page === "settings" && user ? <SettingsPage /> : null}
      </main>
      <Tooltip />
    </div>
  );
};

export default App;
