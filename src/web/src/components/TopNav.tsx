import type { AuthUser } from "../../../shared/types/index.js";

type TopNavProps = {
  authenticated: boolean;
  activePage: "setup" | "login" | "dashboard" | "instances" | "addon-library" | "settings";
  user: AuthUser | null;
  onLogout: () => void;
  onNavigate: (page: "dashboard" | "instances" | "addon-library" | "settings") => void;
};

const TopNav = ({ authenticated, activePage, user, onLogout, onNavigate }: TopNavProps) => {
  return (
    <header className="top-nav">
      <div className="brand-lockup">
        <img className="brand-mark" src="/Chroma-logo.png" alt="" aria-hidden="true" />
        <div>
          <div className="brand-name">Chroma</div>
          <div className="brand-subtitle">Server Manager</div>
        </div>
      </div>

      {authenticated ? (
        <nav className="top-links" aria-label="Primary">
          <button
            type="button"
            className={activePage === "dashboard" ? "nav-link active" : "nav-link"}
            onClick={() => onNavigate("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activePage === "instances" ? "nav-link active" : "nav-link"}
            onClick={() => onNavigate("instances")}
          >
            Instances
          </button>
          <button
            type="button"
            className={activePage === "addon-library" ? "nav-link active" : "nav-link"}
            onClick={() => onNavigate("addon-library")}
          >
            Addon Library
          </button>
          <button
            type="button"
            className={activePage === "settings" ? "nav-link active" : "nav-link"}
            onClick={() => onNavigate("settings")}
          >
            Settings
          </button>
        </nav>
      ) : (
        <div />
      )}

      {authenticated && user ? (
        <div className="user-panel">
          <span className="user-name">{user.username}</span>
          <button type="button" className="secondary-button" onClick={onLogout}>
            Logout
          </button>
        </div>
      ) : (
        <div />
      )}
    </header>
  );
};

export default TopNav;
