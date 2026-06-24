import { useEffect, useState } from "react";
import { getAppSettings } from "../api/chromaApi.js";

const DEFAULT_NOTIFICATION_DURATION_MS = 2000;

export function useNotificationDurationMs(): number {
  const [notificationDurationMs, setNotificationDurationMs] = useState(DEFAULT_NOTIFICATION_DURATION_MS);

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      try {
        const result = await getAppSettings();
        if (!active) {
          return;
        }

        setNotificationDurationMs(Math.max(1000, result.settings.notificationDurationSeconds * 1000));
      } catch {
        if (!active) {
          return;
        }

        setNotificationDurationMs(DEFAULT_NOTIFICATION_DURATION_MS);
      }
    }

    void loadSettings();

    return () => {
      active = false;
    };
  }, []);

  return notificationDurationMs;
}
