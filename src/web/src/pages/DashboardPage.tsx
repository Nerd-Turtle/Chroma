import { useEffect, useState } from "react";
import type {
  DashboardHealthSegment,
  DashboardInstancePerformance,
  DashboardSummary,
} from "../../../shared/types/index.js";
import { getDashboardSummary } from "../api/chromaApi.js";

const HEALTH_SEGMENT_COLORS: Record<DashboardHealthSegment["healthCategory"], string> = {
  healthy: "#60d291",
  error: "#ffb45e",
  stopped: "rgba(255, 255, 255, 0.22)",
};

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }

  return `${value.toFixed(1)}%`;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function calculateUsagePercent(value: number | undefined, total: number | undefined): number | undefined {
  if (value === undefined || total === undefined || total <= 0) {
    return undefined;
  }

  return (value / total) * 100;
}

function getRuntimeToneClass(instance: DashboardInstancePerformance): string {
  if (instance.healthCategory === "healthy") {
    return "status-running";
  }

  if (instance.healthCategory === "stopped") {
    return "status-stopped";
  }

  return "status-warning";
}

function getRuntimeLabel(instance: DashboardInstancePerformance): string {
  if (instance.healthCategory === "healthy") {
    return "Healthy";
  }

  if (instance.healthCategory === "stopped") {
    return "Stopped";
  }

  return formatLabel(instance.status);
}

function buildHealthRingSegments(segments: DashboardHealthSegment[]) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  if (segments.length === 0) {
    return { radius, circumference, slices: [] as Array<DashboardHealthSegment & { dashArray: string; dashOffset: number; color: string }> };
  }

  const sliceLength = circumference / segments.length;
  const gapLength = Math.min(5, sliceLength * 0.16);
  let offset = 0;

  return {
    radius,
    circumference,
    slices: segments.map((segment) => {
      const dashLength = Math.max(sliceLength - gapLength, 0);
      const slice = {
        ...segment,
        dashArray: `${dashLength} ${circumference - dashLength}`,
        dashOffset: -offset,
        color: HEALTH_SEGMENT_COLORS[segment.healthCategory],
      };
      offset += sliceLength;
      return slice;
    }),
  };
}

const DashboardPage = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [hoveredSegmentId, setHoveredSegmentId] = useState("");

  useEffect(() => {
    let isDisposed = false;

    async function loadSummary() {
      try {
        const nextSummary = await getDashboardSummary();

        if (isDisposed) {
          return;
        }

        setSummary(nextSummary);
        setError("");
      } catch (summaryError) {
        if (isDisposed) {
          return;
        }

        setError(summaryError instanceof Error ? summaryError.message : "Unable to load dashboard");
      }
    }

    void loadSummary();
    const refreshTimer = window.setInterval(() => {
      void loadSummary();
    }, 5000);

    return () => {
      isDisposed = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const hoveredSegment = summary?.instanceHealth.segments.find((segment) => segment.instanceId === hoveredSegmentId);
  const healthRing = buildHealthRingSegments(summary?.instanceHealth.segments ?? []);

  return (
    <section className="dashboard-layout">
      {error ? <div className="page-panel form-error">{error}</div> : null}

      <div className="dashboard-grid">
        <article className="page-panel dashboard-widget">
          <div className="dashboard-widget-header">
            <h2>System Performance</h2>
          </div>

          <div className="dashboard-metric-stack">
            <div className="dashboard-meter">
              <div className="dashboard-meter-label">
                <span>Total CPU Usage</span>
                <strong>{formatPercent(summary?.systemPerformance.cpuUsagePercent)}</strong>
              </div>
              <div className="dashboard-meter-track" aria-hidden="true">
                <div
                  className="dashboard-meter-fill"
                  style={{ width: `${summary?.systemPerformance.cpuUsagePercent ?? 0}%` }}
                />
              </div>
            </div>

            <div className="dashboard-meter">
              <div className="dashboard-meter-label">
                <span>Total RAM Usage</span>
                <strong>{formatPercent(summary?.systemPerformance.ramUsagePercent)}</strong>
              </div>
              <div className="dashboard-meter-track" aria-hidden="true">
                <div
                  className="dashboard-meter-fill dashboard-meter-fill-ram"
                  style={{ width: `${summary?.systemPerformance.ramUsagePercent ?? 0}%` }}
                />
              </div>
              <p className="dashboard-widget-note">
                {summary
                  ? `${formatBytes(summary.systemPerformance.ramUsageBytes)} of ${formatBytes(summary.systemPerformance.ramTotalBytes)}`
                  : "Loading host memory usage..."}
              </p>
            </div>
          </div>
        </article>

        <article className="page-panel dashboard-widget">
          <div className="dashboard-widget-header">
            <h2>Instance Health</h2>
          </div>

          <div className="dashboard-health-widget">
            <div className="dashboard-health-ring-wrap">
              <svg className="dashboard-health-ring" viewBox="0 0 140 140" role="img" aria-label="Instance health overview">
                <circle cx="70" cy="70" r={healthRing.radius} className="dashboard-health-ring-base" />
                {healthRing.slices.map((segment) => (
                  <circle
                    key={segment.instanceId}
                    cx="70"
                    cy="70"
                    r={healthRing.radius}
                    className={`dashboard-health-ring-segment${hoveredSegmentId === segment.instanceId ? " is-hovered" : ""}`}
                    stroke={segment.color}
                    strokeDasharray={segment.dashArray}
                    strokeDashoffset={segment.dashOffset}
                    onMouseEnter={() => setHoveredSegmentId(segment.instanceId)}
                    onMouseLeave={() => setHoveredSegmentId("")}
                    onFocus={() => setHoveredSegmentId(segment.instanceId)}
                    onBlur={() => setHoveredSegmentId("")}
                    tabIndex={0}
                  >
                    <title>{`${segment.friendlyName}: ${formatLabel(segment.healthCategory)}`}</title>
                  </circle>
                ))}
              </svg>
              <div className="dashboard-health-ring-center">
                <strong>{summary?.instanceCount ?? 0}</strong>
                <span>Instances</span>
              </div>
            </div>

            <div className="dashboard-health-summary">
              <div className="dashboard-health-legend">
                <span className="dashboard-health-key dashboard-health-key-healthy" />
                <strong>{summary?.instanceHealth.healthyCount ?? 0}</strong>
                <span>Healthy</span>
              </div>
              <div className="dashboard-health-legend">
                <span className="dashboard-health-key dashboard-health-key-error" />
                <strong>{summary?.instanceHealth.errorCount ?? 0}</strong>
                <span>Attention</span>
              </div>
              <div className="dashboard-health-legend">
                <span className="dashboard-health-key dashboard-health-key-stopped" />
                <strong>{summary?.instanceHealth.stoppedCount ?? 0}</strong>
                <span>Stopped</span>
              </div>
              {hoveredSegment ? (
                <p className="dashboard-widget-note">
                  {hoveredSegment.friendlyName} • {formatLabel(hoveredSegment.healthCategory)}
                </p>
              ) : null}
            </div>
          </div>
        </article>

        <article className="page-panel dashboard-widget dashboard-player-widget">
          <div className="dashboard-widget-header">
            <h2>Total Players</h2>
          </div>

          <div className="dashboard-total-players">
            <strong>{summary?.totalPlayerCount ?? 0}</strong>
            <span>{summary?.totalPlayerCount === 1 ? "Player online" : "Players online"}</span>
            {summary?.playerCountUnavailableInstanceCount ? (
              <small className="dashboard-player-count-warning">
                {summary.playerCountUnavailableInstanceCount} live count unavailable
              </small>
            ) : null}
          </div>
        </article>

        <article className="dashboard-widget dashboard-widget-wide dashboard-performance-section">
          <div className="dashboard-widget-header">
            <h2>Instance Performance</h2>
          </div>

          {summary?.instancePerformance.length ? (
            <div className="dashboard-instance-table" role="table" aria-label="Per-instance performance">
              <div className="dashboard-instance-table-header" role="row">
                <span role="columnheader">Instance</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">CPU usage</span>
                <span role="columnheader">Memory</span>
                <span role="columnheader">Players</span>
              </div>

              {summary.instancePerformance.map((instance) => {
                const memoryUsagePercent = calculateUsagePercent(
                  instance.ramUsageBytes,
                  summary.systemPerformance.ramTotalBytes,
                );

                return (
                  <div key={instance.instanceId} className="dashboard-instance-row" role="row">
                    <strong className="dashboard-instance-name" role="cell">{instance.friendlyName}</strong>
                    <span className={`instance-bds-status ${getRuntimeToneClass(instance)}`} role="cell">
                      <span className="dashboard-instance-status-dot" aria-hidden="true" />
                      {getRuntimeLabel(instance)}
                    </span>
                    <div className="dashboard-instance-cpu" role="cell">
                      <span className="dashboard-instance-metric-label">CPU</span>
                      <strong>{formatPercent(instance.cpuUsagePercent)}</strong>
                      <div className="dashboard-instance-cpu-track" aria-hidden="true">
                        <span
                          className="dashboard-instance-cpu-fill"
                          style={{ width: `${Math.min(100, Math.max(0, instance.cpuUsagePercent ?? 0))}%` }}
                        />
                      </div>
                    </div>
                    <div className="dashboard-instance-memory" role="cell">
                      <span className="dashboard-instance-metric-label">Memory</span>
                      <strong>{formatBytes(instance.ramUsageBytes)}</strong>
                      {memoryUsagePercent !== undefined ? (
                        <span className="dashboard-instance-memory-percent">{formatPercent(memoryUsagePercent)}</span>
                      ) : null}
                      <div className="dashboard-instance-memory-track" aria-hidden="true">
                        <span
                          className="dashboard-instance-memory-fill"
                          style={{ width: `${Math.min(100, Math.max(0, memoryUsagePercent ?? 0))}%` }}
                        />
                      </div>
                    </div>
                    <div className="dashboard-instance-metric" role="cell">
                      <span className="dashboard-instance-metric-label">Players</span>
                      <strong
                        title={instance.playerCount === undefined ? "Live player count is unavailable for this instance." : undefined}
                      >
                        {instance.playerCount ?? "--"} / {instance.maxPlayers}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="dashboard-widget-note">Create an instance to start seeing per-server runtime telemetry here.</p>
          )}
        </article>
      </div>
    </section>
  );
};

export default DashboardPage;
