import { useEffect } from "react";
import { getSession, recordSessionActivity } from "../api/chromaApi.js";

export function useSessionActivity(authenticated: boolean, showLogin: () => void): void {
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    let lastSent = 0;
    let activityTimer: number | undefined;

    async function checkSession() {
      try {
        const session = await getSession();
        if (active && !session.authenticated) showLogin();
      } catch { /* A network interruption does not invalidate a session. */ }
    }
    async function sendActivity() {
      activityTimer = undefined;
      if (!active || document.visibilityState !== "visible") return;
      lastSent = Date.now();
      try { await recordSessionActivity(); }
      catch { /* API 401 handling redirects; network failures must not claim success. */ }
    }
    function onActivity(event: Event) {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      // Only user input schedules a heartbeat. Timers/polling/focus never renew idle time.
      // This is a UI convenience; the server validates the stored deadline before renewal.
      if (Date.now() - lastSent >= 30_000) {
        window.clearTimeout(activityTimer);
        void sendActivity();
      } else if (activityTimer === undefined) {
        activityTimer = window.setTimeout(() => void sendActivity(), 30_000 - (Date.now() - lastSent));
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") void checkSession();
    }
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", onVisibility);
    // Read-only inspection also expires idle workspaces which have no page-specific polling.
    const checkTimer = window.setInterval(() => void checkSession(), 15_000);
    return () => {
      active = false;
      window.clearTimeout(activityTimer);
      window.clearInterval(checkTimer);
      for (const event of events) window.removeEventListener(event, onActivity);
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authenticated, showLogin]);
}
