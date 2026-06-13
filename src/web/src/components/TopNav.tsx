import type { AuthSessionResponse } from "../api/chromaApi";

type TopNavProps = {
  activePage: "setup" | "login" | "dashboard";
  authenticated: boolean;
  user: AuthSessionResponse["user"] | null;
  onNavigate: (page: "setup" | "login" | "dashboard") => void;
  onLogout: () => void;
};

const TopNav = ({ activePage, authenticated, user, onNavigate, onLogout }: TopNavProps) => {
  return (
    <header className="top-nav">
      <div className="brand">
        <span className="brand-mark">Chroma</span>
      </div>

      <nav className="nav-links">
        <button className={activePage === "dashboard" ? "active" : ""} onClick={() => onNavigate("dashboard")}>Dashboard</button>
        <button disabled>Instances</button>
        <button disabled>Addons</button>
        <button disabled>Settings</button>
      </nav>

      <div className="user-actions">
        {authenticated && user ? (
          <>
            <span className="username">{user.username}</span>
            <button className="logout-button" onClick={onLogout}>Logout</button>
          </>
        ) : null}
      </div>
    </header>
  );
};

export default TopNav;
