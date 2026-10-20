import { useEffect, useState } from "react";
import { getChromaUpdateStatus } from "../api/chromaApi.js";

const ChromaUpdateNotice = ({ onOpen }: { onOpen: () => void }) => {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const status = await getChromaUpdateStatus();
        if (!disposed) setVersion(status.updateAvailable ? status.latestRelease?.version ?? null : null);
      } catch { /* The notice can wait for the next poll while Chroma restarts. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  return version ? (
    <button type="button" className="secondary-button chroma-update-notice" onClick={onOpen} data-tooltip={`Chroma ${version} is available. Open Settings to review the update.`}>
      Chroma update available
    </button>
  ) : null;
};

export default ChromaUpdateNotice;
