import type { AuthUser } from "../../../shared/types/index.js";

type TopNavProps = {
  authenticated: boolean;
  activePage: "setup" | "login" | "dashboard";
  user: AuthUser | null;
  onLogout: () => void;
};

const TopNav = ({ authenticated, activePage, user, onLogout }: TopNavProps) => {
  return (
    <header className="top-nav">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-name">Chroma</div>
          <div className="brand-subtitle">Server Manager</div>
        </div>
      </div>

      <nav className="top-links" aria-label="Primary">
        <span className={activePage === "dashboard" ? "nav-link active" : "nav-link"}>Dashboard</span>
        <span className="nav-link muted">Instances</span>
        <span className="nav-link muted">Addons</span>
        <span className="nav-link muted">Settings</span>
      </nav>

      <div className="user-panel">
        {authenticated && user ? (
          <>
            <span className="user-name">{user.username}</span>
            <button type="button" className="secondary-button" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <span className="user-name">{activePage === "setup" ? "First-start setup" : "Local login"}</span>
        )}
      </div>
    </header>
  );
};

export default TopNav;
