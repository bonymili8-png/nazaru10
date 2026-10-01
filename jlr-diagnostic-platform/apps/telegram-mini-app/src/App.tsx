import { useEffect } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { Banner, Spinner } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { Dtcs } from "./screens/Dtcs";
import { Ecus } from "./screens/Ecus";
import { History } from "./screens/History";
import { LiveData } from "./screens/LiveData";
import { Logs } from "./screens/Logs";
import { Scan } from "./screens/Scan";
import { Settings } from "./screens/Settings";
import { VehicleDetails, Vehicles } from "./screens/Vehicles";
import { SessionProvider, useSession } from "./state/session";
import { telegram } from "./telegram";

const TABS: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Home", icon: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { to: "/dtcs", label: "DTC", icon: "M12 3 2 20h20zM12 10v4m0 3v.01" },
  { to: "/live", label: "Live", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { to: "/ecus", label: "ECUs", icon: "M7 7h10v10H7zM4 10h3m-3 4h3m10-4h3m-3 4h3M10 4v3m4-3v3m-4 10v3m4-3v3" },
  { to: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `tab ${isActive ? "tab-active" : ""}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function More() {
  const navigate = useNavigate();
  const items: [string, string, string][] = [
    ["/vehicles", "Vehicles", "All registered vehicles"],
    ["/vehicle", "Vehicle details", "Profile, identity and connection"],
    ["/scan", "Full scan", "Discover ECUs and read DTCs"],
    ["/history", "History", "Scans and DTC timeline"],
    ["/logs", "Logs", "Audit log and operations"],
    ["/settings", "Settings", "Professional mode, gateway, roadmap"],
  ];
  return (
    <main className="screen">
      <header className="screen-header">
        <h1>More</h1>
      </header>
      <ul className="list">
        {items.map(([to, label, hint]) => (
          <li key={to}>
            <button type="button" className="list-item" onClick={() => navigate(to)}>
              <span className="list-main">
                <strong>{label}</strong>
                <span className="muted small">{hint}</span>
              </span>
              <span aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** Wires Telegram's native back button to router history on nested screens. */
function TelegramBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const button = telegram()?.BackButton;
    if (!button) return;
    const back = () => navigate(-1);
    if (location.pathname === "/") button.hide();
    else button.show();
    button.onClick(back);
    return () => button.offClick(back);
  }, [location.pathname, navigate]);
  return null;
}

function Shell() {
  const { loading, error, user, retry } = useSession();
  if (loading && !user) return <Spinner label="Signing in…" />;
  if (!user) {
    return (
      <main className="screen">
        <Banner onRetry={retry}>{error ?? "Not signed in."}</Banner>
      </main>
    );
  }
  return (
    <>
      <TelegramBackButton />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/vehicles" element={<Vehicles />} />
        <Route path="/vehicle" element={<VehicleDetails />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/ecus" element={<Ecus />} />
        <Route path="/dtcs" element={<Dtcs />} />
        <Route path="/live" element={<LiveData />} />
        <Route path="/history" element={<History />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
      <TabBar />
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SessionProvider>
  );
}
