import type { AuthUser } from "../../../shared/types/index.js";

type TopNavProps = {
  authenticated: boolean;
  activePage: "setup" | "login" | "dashboard" | "instances";
  user: AuthUser | null;
  onLogout: () => void;
  onNavigate: (page: "dashboard" | "instances") => void;
};

const TopNav = ({ authenticated, activePage, user, onLogout, onNavigate }: TopNavProps) => {
  return (
    <header className="top-nav">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true" />
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
          <span className="nav-link muted">Addons</span>
          <span className="nav-link muted">Settings</span>
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
