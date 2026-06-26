import { ArrowDownToLine, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CurseForgeAddonProviderStatus,
  CurseForgeAddonSearchAuthor,
  CurseForgeAddonSearchPagination,
  CurseForgeAddonSearchResult,
  CurseForgeAddonSearchSort,
  AddonLibraryItem,
  AddonLibraryLinkedInstance,
  AddonUpdateSettings,
} from "../../../shared/types/index.js";
import {
  deleteAddonFromLibrary,
  downloadCurseForgeAddonToLibrary,
  getAddonLibraryEditor,
  getAddonLibrary,
  getAddonUpdateSettings,
  getLibraryCurseForgeAddonProviderStatus,
  searchLibraryCurseForgeAddons,
  updateAddonLibraryLinks,
  updateAddonUpdateSettings,
} from "../api/chromaApi.js";
import { useNotificationDurationMs } from "../components/useNotificationDurationMs.js";

type CurseForgeSearchState = {
  results: CurseForgeAddonSearchResult[];
  pagination: CurseForgeAddonSearchPagination | null;
};

type ActiveAuthorFilter = Pick<CurseForgeAddonSearchAuthor, "id" | "name">;

type BannerTone = "info" | "warning" | "error";

type BannerState = {
  message: string;
  tone: BannerTone;
};

type AddonLibraryEditorState = {
  addon: AddonLibraryItem;
  instances: AddonLibraryLinkedInstance[];
};

type AddonLibraryTab = "browse" | "downloaded";
const CURSEFORGE_SEARCH_PAGE_SIZE = 50;

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Pending";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCurseForgeSort(value: CurseForgeAddonSearchSort): string {
  switch (value) {
    case "relevance":
      return "Relevance";
    case "last_updated":
      return "Latest update";
    case "total_downloads":
      return "Total downloads";
    case "released_date":
      return "Release date";
    case "rating":
      return "Rating";
    case "popularity":
    default:
      return "Popularity";
  }
}

function getAuthorSearchText(author: ActiveAuthorFilter): string {
  return `author: ${author.name}`;
}

function compareGameVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }

  return 0;
}

function getLatestSupportedGameVersion(gameVersions: string[]): string {
  const versionPattern = /^\d+(?:\.\d+){1,3}$/;
  const versions = gameVersions.filter((version) => versionPattern.test(version));

  if (versions.length > 0) {
    return [...versions].sort(compareGameVersions)[0] ?? "Unknown";
  }

  return gameVersions[0] ?? "Unknown";
}

function getAddonPackSummary(addon: AddonLibraryItem): string {
  const parts = [
    addon.packCounts.behavior > 0 ? `${addon.packCounts.behavior} behavior` : "",
    addon.packCounts.resource > 0 ? `${addon.packCounts.resource} resource` : "",
    addon.packCounts.skin > 0 ? `${addon.packCounts.skin} skin pack` : "",
    addon.packCounts.unknown > 0 ? `${addon.packCounts.unknown} unknown` : "",
    addon.packCounts.unsupported > 0 ? `${addon.packCounts.unsupported} unsupported` : "",
  ].filter((part) => part !== "");

  return parts.length > 0 ? parts.join(", ") : "No packs discovered";
}

const AddonLibraryPage = () => {
  const [libraryAddons, setLibraryAddons] = useState<AddonLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState<CurseForgeAddonProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeAuthorFilter, setActiveAuthorFilter] = useState<ActiveAuthorFilter | null>(null);
  const [sort, setSort] = useState<CurseForgeAddonSearchSort>("popularity");
  const [search, setSearch] = useState<CurseForgeSearchState>({ results: [], pagination: null });
  const [searching, setSearching] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null);
  const [completedDownloadFileId, setCompletedDownloadFileId] = useState<number | null>(null);
  const [deletingAddonId, setDeletingAddonId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<AddonLibraryTab>("browse");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [addonUpdateSettings, setAddonUpdateSettings] = useState<AddonUpdateSettings | null>(null);
  const [addonUpdateSettingsLoading, setAddonUpdateSettingsLoading] = useState(true);
  const [addonUpdateSettingsSaving, setAddonUpdateSettingsSaving] = useState(false);
  const [addonUpdateEditorOpen, setAddonUpdateEditorOpen] = useState(false);
  const [editingAddonId, setEditingAddonId] = useState("");
  const [addonEditorData, setAddonEditorData] = useState<AddonLibraryEditorState | null>(null);
  const [addonEditorLoading, setAddonEditorLoading] = useState(false);
  const [addonEditorSaving, setAddonEditorSaving] = useState(false);
  const [selectedLinkedInstanceIds, setSelectedLinkedInstanceIds] = useState<string[]>([]);
  const [linkedInstanceAutoUpdates, setLinkedInstanceAutoUpdates] = useState<Record<string, boolean>>({});
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const searchResultsRef = useRef<HTMLDivElement | null>(null);
  const notificationDurationMs = useNotificationDurationMs();

  const canBrowse = providerStatus?.resolved === true;
  const downloadedFileKeys = new Set(
    libraryAddons
      .filter((addon) => addon.provider === "curseforge")
      .map((addon) => `${addon.providerProjectId}:${addon.providerFileId}`),
  );
  const downloadedProjectIds = new Set(
    libraryAddons
      .filter((addon) => addon.provider === "curseforge")
      .map((addon) => addon.providerProjectId)
      .filter((projectId) => projectId !== ""),
  );

  async function loadLibrary() {
    setLoading(true);
    setError("");

    try {
      const addonLibraryResult = await getAddonLibrary();

      setLibraryAddons(addonLibraryResult.addons);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load addon library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    async function loadProviderStatus() {
      setProviderLoading(true);
      setError("");

      try {
        const result = await getLibraryCurseForgeAddonProviderStatus();
        setProviderStatus(result.provider);
      } catch (loadError) {
        setProviderStatus(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load CurseForge provider status");
      } finally {
        setProviderLoading(false);
      }
    }

    void loadProviderStatus();
  }, []);

  useEffect(() => {
    async function loadAddonSettings() {
      setAddonUpdateSettingsLoading(true);

      try {
        const result = await getAddonUpdateSettings();
        setAddonUpdateSettings(result.settings);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load addon update settings");
      } finally {
        setAddonUpdateSettingsLoading(false);
      }
    }

    void loadAddonSettings();
  }, []);

  useEffect(() => {
    if (completedDownloadFileId === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCompletedDownloadFileId(null);
    }, 1600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [completedDownloadFileId]);

  useEffect(() => {
    if (!banner) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBanner(null);
    }, notificationDurationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [banner, notificationDurationMs]);

  useEffect(() => {
    resultsAnchorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });

    if (searchResultsRef.current) {
      searchResultsRef.current.scrollTop = 0;
    }
  }, [search.pagination?.page]);

  async function runSearch(
    page: number,
    nextSearch?: { query: string; authorFilter: ActiveAuthorFilter | null },
  ) {
    if (!canBrowse) {
      return;
    }

    setSearching(true);
    setError("");
    setBanner(null);

    try {
      const searchQuery = nextSearch?.query ?? query;
      const authorFilter = nextSearch ? nextSearch.authorFilter : activeAuthorFilter;
      const result = await searchLibraryCurseForgeAddons({
        ...(authorFilter ? { authorId: authorFilter.id } : { q: searchQuery }),
        sort,
        page,
        pageSize: CURSEFORGE_SEARCH_PAGE_SIZE,
      });

      setProviderStatus(result.provider);
      setSearch({
        results: result.results,
        pagination: result.pagination,
      });
      requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });

        if (searchResultsRef.current) {
          searchResultsRef.current.scrollTop = 0;
        }
      });
    } catch (searchError) {
      setSearch({ results: [], pagination: null });
      setError(searchError instanceof Error ? searchError.message : "Unable to search CurseForge");
    } finally {
      setSearching(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(1);
  }

  async function handleAuthorFilter(author: CurseForgeAddonSearchAuthor) {
    const authorFilter = { id: author.id, name: author.name };
    const authorQuery = getAuthorSearchText(authorFilter);

    setActiveAuthorFilter(authorFilter);
    setQuery(authorQuery);
    await runSearch(1, { query: authorQuery, authorFilter });
  }

  async function handleDownload(result: CurseForgeAddonSearchResult) {
    if (!result.latestFileId) {
      return;
    }

    setDownloadingFileId(result.latestFileId);
    setError("");
    setBanner(null);

    try {
      await downloadCurseForgeAddonToLibrary({
        projectId: result.projectId,
        fileId: result.latestFileId,
      });
      await loadLibrary();
      setCompletedDownloadFileId(result.latestFileId);
      setBanner({
        tone: "info",
        message: `Downloaded ${result.name}.`,
      });
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download CurseForge addon");
    } finally {
      setDownloadingFileId(null);
    }
  }

  async function handleDeleteLibraryAddon(addon: AddonLibraryItem) {
    setDeletingAddonId(addon.id);
    setError("");
    setBanner(null);

    try {
      await deleteAddonFromLibrary(addon.id);
      await loadLibrary();
      setBanner({
        tone: "info",
        message: `Deleted ${addon.name}.`,
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete addon");
    } finally {
      setDeletingAddonId("");
    }
  }

  function applyEditorState(nextState: AddonLibraryEditorState) {
    setAddonEditorData(nextState);
    setSelectedLinkedInstanceIds(
      nextState.instances.filter((instance) => instance.linked).map((instance) => instance.instanceId),
    );
    setLinkedInstanceAutoUpdates(
      Object.fromEntries(nextState.instances.map((instance) => [instance.instanceId, instance.autoUpdateEnabled])),
    );
  }

  async function openAddonEditor(addon: AddonLibraryItem) {
    setEditingAddonId(addon.id);
    setAddonEditorLoading(true);
    setAddonEditorSaving(false);
    setError("");
    setBanner(null);

    try {
      const result = await getAddonLibraryEditor(addon.id);
      applyEditorState(result);
    } catch (loadError) {
      setEditingAddonId("");
      setAddonEditorData(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load addon editor");
    } finally {
      setAddonEditorLoading(false);
    }
  }

  function closeAddonEditor() {
    if (addonEditorSaving) {
      return;
    }

    setEditingAddonId("");
    setAddonEditorData(null);
    setSelectedLinkedInstanceIds([]);
    setLinkedInstanceAutoUpdates({});
    setAddonEditorLoading(false);
  }

  function toggleLinkedInstance(instanceId: string) {
    setSelectedLinkedInstanceIds((current) => {
      if (current.includes(instanceId)) {
        return current.filter((value) => value !== instanceId);
      }

      return [...current, instanceId];
    });

    setLinkedInstanceAutoUpdates((current) => ({
      ...current,
      [instanceId]: current[instanceId] ?? true,
    }));
  }

  function toggleLinkedInstanceAutoUpdate(instanceId: string) {
    setLinkedInstanceAutoUpdates((current) => ({
      ...current,
      [instanceId]: !(current[instanceId] ?? true),
    }));
  }

  async function handleSaveAddonEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingAddonId) {
      return;
    }

    setAddonEditorSaving(true);
    setError("");
    setBanner(null);

    try {
      const result = await updateAddonLibraryLinks(editingAddonId, {
        links: selectedLinkedInstanceIds.map((instanceId) => ({
          instanceId,
          autoUpdateEnabled: linkedInstanceAutoUpdates[instanceId] ?? true,
        })),
      });
      applyEditorState(result);
      await loadLibrary();
      setEditingAddonId("");
      setAddonEditorData(null);
      setSelectedLinkedInstanceIds([]);
      setLinkedInstanceAutoUpdates({});
      setAddonEditorLoading(false);
      setBanner({
        tone: "info",
        message: `Saved linked instances for ${result.addon.name}.`,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save addon links");
    } finally {
      setAddonEditorSaving(false);
    }
  }

  async function handleSaveAddonUpdateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!addonUpdateSettings) {
      return;
    }

    setAddonUpdateSettingsSaving(true);
    setError("");
    setBanner(null);

    try {
      const result = await updateAddonUpdateSettings(addonUpdateSettings);
      setAddonUpdateSettings(result.settings);
      setAddonUpdateEditorOpen(false);
      setBanner({
        tone: "info",
        message: "Addon update settings saved.",
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save addon update settings");
    } finally {
      setAddonUpdateSettingsSaving(false);
    }
  }

  const totalSearchPages = search.pagination ? Math.max(1, Math.ceil(search.pagination.totalCount / search.pagination.pageSize)) : 1;
  const currentSearchPage = search.pagination?.page ?? 1;
  const canGoToPreviousSearchPage = canBrowse && !searching && currentSearchPage > 1;
  const canGoToNextSearchPage = canBrowse && !searching && search.pagination !== null && currentSearchPage < totalSearchPages;
  const linkedInstances = addonEditorData
    ? addonEditorData.instances.filter((instance) => selectedLinkedInstanceIds.includes(instance.instanceId))
    : [];
  const showAddonUpdateControls = activeTab === "downloaded" && !addonUpdateSettingsLoading && addonUpdateSettings;

  return (
    <section className="addon-library-layout">
      <div className="status-banner-layer" aria-live="polite">
        {error ? (
          <div className="status-banner status-banner-error" role="alert">
            <span>{error}</span>
            <button type="button" className="status-banner-close" onClick={() => setError("")} aria-label="Dismiss alert">
              Close
            </button>
          </div>
        ) : null}
        {banner ? (
          <div className={`status-banner status-banner-${banner.tone}`} role="status">
            <span>{banner.message}</span>
            <button
              type="button"
              className="status-banner-close"
              onClick={() => setBanner(null)}
              aria-label="Dismiss notification"
            >
              Close
            </button>
          </div>
        ) : null}
      </div>

      <nav className="addon-library-tabs" aria-label="Addon Library sections">
        <div className="addon-library-tab-list">
          <button
            type="button"
            className={activeTab === "browse" ? "addon-library-tab active" : "addon-library-tab"}
            onClick={() => setActiveTab("browse")}
          >
            Browse
          </button>
          <button
            type="button"
            className={activeTab === "downloaded" ? "addon-library-tab active" : "addon-library-tab"}
            onClick={() => setActiveTab("downloaded")}
          >
            Downloaded
          </button>
        </div>

        {showAddonUpdateControls ? (
          <div className="addon-library-tab-tools">
            <span className="addon-library-tab-tools-label">Enable Auto-Updates</span>
            <button
              type="button"
              className={addonUpdateSettings.automaticChecksEnabled ? "toggle-switch active" : "toggle-switch"}
              aria-label="Toggle automatic addon updates"
              aria-pressed={addonUpdateSettings.automaticChecksEnabled}
              onClick={() =>
                setAddonUpdateSettings((current) =>
                  current
                    ? {
                        ...current,
                        automaticChecksEnabled: !current.automaticChecksEnabled,
                      }
                    : current,
                )
              }
              disabled={addonUpdateSettingsSaving}
            >
              <span className="toggle-switch-thumb" />
            </button>
            {addonUpdateSettings.automaticChecksEnabled ? (
              <button
                type="button"
                className="icon-action"
                onClick={() => setAddonUpdateEditorOpen(true)}
                disabled={addonUpdateSettingsSaving}
                aria-label="Edit addon update schedule"
                title="Edit addon update schedule"
              >
                <Pencil aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </nav>

      {activeTab === "browse" ? (
        <section className="addon-library-section addon-library-section-browse">
          {loading ? <p className="muted-copy">Loading addon library...</p> : null}
          {!providerLoading && providerStatus && !providerStatus.resolved ? (
            <div className="form-error">{providerStatus.message ?? "CurseForge browsing is not available."}</div>
          ) : null}

          <form className="addon-library-search-form" onSubmit={handleSearch}>
            <label>
              Search
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveAuthorFilter(null);
                }}
                placeholder="Name or keyword"
                disabled={!canBrowse || searching}
              />
            </label>
            <label>
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CurseForgeAddonSearchSort)}
                disabled={!canBrowse || searching}
              >
                {(["popularity", "last_updated", "total_downloads", "released_date", "rating", "relevance"] as CurseForgeAddonSearchSort[]).map((sortOption) => (
                  <option key={sortOption} value={sortOption}>
                    {formatCurseForgeSort(sortOption)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-button" disabled={!canBrowse || searching}>
              {searching ? "Searching..." : "Browse CurseForge"}
            </button>
          </form>

          {search.pagination ? (
            <div ref={resultsAnchorRef} className="addon-library-results-toolbar">
              <span>
                Showing {search.pagination.resultCount} of {formatNumber(search.pagination.totalCount)} results
              </span>
              <span className="addon-library-pagination-actions">
                <button
                  type="button"
                  className="pagination-icon-button"
                  disabled={!canGoToPreviousSearchPage}
                  onClick={() => void runSearch(currentSearchPage - 1)}
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
                <span className="addon-library-page-count">
                  Page {currentSearchPage} of {formatNumber(totalSearchPages)}
                </span>
                <button
                  type="button"
                  className="pagination-icon-button"
                  disabled={!canGoToNextSearchPage}
                  onClick={() => void runSearch(currentSearchPage + 1)}
                  aria-label="Next page"
                  title="Next page"
                >
                  <ChevronRight aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
              </span>
            </div>
          ) : null}

          {search.results.length > 0 ? (
            <div
              ref={searchResultsRef}
              className="instance-addon-search-results addon-library-search-results"
              role="table"
              aria-label="CurseForge addon search results"
            >
              <div className="instance-addon-search-header" role="row">
                <span role="columnheader">Addon</span>
                <span role="columnheader">Author</span>
                <span role="columnheader">Downloads</span>
                <span role="columnheader">Latest Supported</span>
                <span role="columnheader">Updated</span>
                <span role="columnheader">Action</span>
              </div>
              {search.results.map((result) => {
                const isCurrentFileDownloaded = result.latestFileId
                  ? downloadedFileKeys.has(`${result.projectId}:${result.latestFileId}`)
                  : false;
                const hasDownloadedVersion = downloadedProjectIds.has(String(result.projectId));
                const hasUpdateAvailable = hasDownloadedVersion && !isCurrentFileDownloaded && Boolean(result.latestFileId);
                const isCompleting = result.latestFileId !== undefined && completedDownloadFileId === result.latestFileId;
                const actionClassName = isCurrentFileDownloaded || isCompleting
                  ? "icon-action-success"
                  : hasUpdateAvailable
                    ? "icon-action-update"
                    : "icon-action-primary";
                const actionLabel = downloadingFileId === result.latestFileId
                  ? `Downloading ${result.name}`
                  : isCurrentFileDownloaded || isCompleting
                    ? `${result.name} already downloaded`
                    : hasUpdateAvailable
                      ? `Update available for ${result.name}`
                      : `Download ${result.name}`;
                const actionTitle = downloadingFileId === result.latestFileId
                  ? "Downloading addon"
                  : isCurrentFileDownloaded || isCompleting
                    ? "Already downloaded"
                    : hasUpdateAvailable
                      ? "Update available"
                      : "Download addon";

                return (
                  <article key={result.projectId} className="instance-addon-search-row" role="row">
                    <span className="instance-addon-search-name" role="cell">
                      {result.logoUrl ? <img src={result.logoUrl} alt="" loading="lazy" /> : <span className="instance-addon-search-logo-fallback" />}
                      <span>
                        {result.websiteUrl ? (
                          <a className="addon-title-link" href={result.websiteUrl} target="_blank" rel="noreferrer">
                            {result.name}
                          </a>
                        ) : (
                          <strong>{result.name}</strong>
                        )}
                        <small>{result.summary}</small>
                      </span>
                    </span>
                    <span className="addon-author-list" role="cell">
                      {result.authors.length > 0
                        ? result.authors.map((author, index) => (
                            <span key={`${author.id}:${author.name}`}>
                              {index > 0 ? ", " : null}
                              <button
                                type="button"
                                className="addon-author-link"
                                onClick={() => void handleAuthorFilter(author)}
                                disabled={!canBrowse || searching}
                                title={`Show addons by ${author.name}`}
                              >
                                {author.name}
                              </button>
                            </span>
                          ))
                        : "Unknown"}
                    </span>
                    <span role="cell">{formatNumber(result.downloadCount)}</span>
                    <span role="cell">{getLatestSupportedGameVersion(result.latestGameVersions)}</span>
                    <span role="cell">{result.latestFileDate ? formatTimestamp(result.latestFileDate) : "Unknown"}</span>
                    <span role="cell">
                      <button
                        type="button"
                        className={`icon-action ${actionClassName}`}
                        onClick={() => void handleDownload(result)}
                        disabled={!result.latestFileId || downloadingFileId !== null || isCurrentFileDownloaded}
                        aria-label={actionLabel}
                        title={actionTitle}
                      >
                        {downloadingFileId === result.latestFileId ? (
                          <LoaderCircle className="icon-action-spinner" aria-hidden="true" />
                        ) : isCurrentFileDownloaded || isCompleting ? (
                          <CheckCircle2 aria-hidden="true" />
                        ) : hasUpdateAvailable ? (
                          <RefreshCw aria-hidden="true" />
                        ) : (
                          <ArrowDownToLine aria-hidden="true" />
                        )}
                      </button>
                    </span>
                  </article>
                );
              })}
            </div>
          ) : null}
          {search.pagination && search.results.length === 0 && !searching ? (
            <p className="muted-copy">No CurseForge addons matched this search.</p>
          ) : null}
        </section>
      ) : null}

      {activeTab === "downloaded" ? (
        <section className="addon-library-section addon-library-section-downloaded">
          {libraryAddons.length === 0 ? (
            <p className="muted-copy">No addons have been downloaded yet.</p>
          ) : (
            <div className="addon-library-table" role="table" aria-label="Downloaded addon library">
              <div className="addon-library-table-header" role="row">
                <span role="columnheader">Addon</span>
                <span role="columnheader">Instances</span>
                <span role="columnheader">File</span>
                <span role="columnheader">Packs</span>
                <span role="columnheader">Action</span>
              </div>
              {libraryAddons.map((addon) => (
                <article key={addon.id} className="addon-library-table-row" role="row">
                  <span className="instance-addon-name" role="cell">
                    {addon.websiteUrl ? (
                      <a className="addon-title-link" href={addon.websiteUrl} target="_blank" rel="noreferrer">
                        {addon.name}
                      </a>
                    ) : (
                      <strong>{addon.name}</strong>
                    )}
                    {addon.summary ? <small>{addon.summary}</small> : null}
                  </span>
                  <span role="cell">{formatNumber(addon.registeredInstanceCount)}</span>
                  <span className="instance-addon-file" role="cell">
                    <span>{addon.fileDisplayName ?? addon.fileName ?? "Unknown file"}</span>
                    <small>{addon.fileDate ? formatTimestamp(addon.fileDate) : "No file date"}</small>
                  </span>
                  <span role="cell">{getAddonPackSummary(addon)}</span>
                  <span role="cell">
                    <span className="addon-library-row-actions">
                      <button
                        type="button"
                        className="icon-action"
                        onClick={() => void openAddonEditor(addon)}
                        disabled={addonEditorSaving || deletingAddonId !== ""}
                        title="Edit addon links"
                        aria-label={`Edit ${addon.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-action icon-action-danger"
                        onClick={() => void handleDeleteLibraryAddon(addon)}
                        disabled={deletingAddonId !== "" || addon.registeredInstanceCount > 0}
                        title={addon.registeredInstanceCount > 0 ? "Remove this addon from instances before deleting it." : "Delete addon"}
                        aria-label={deletingAddonId === addon.id ? `Deleting ${addon.name}` : `Delete ${addon.name}`}
                      >
                        {deletingAddonId === addon.id ? (
                          <LoaderCircle className="icon-action-spinner" aria-hidden="true" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                      </button>
                    </span>
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {editingAddonId ? (
        <div className="instance-editor-drawer-layer">
          <button
            type="button"
            className="instance-editor-drawer-backdrop"
            aria-label="Close addon editor"
            onClick={closeAddonEditor}
          />
          <aside className="instance-editor-drawer">
            <div className="instance-editor-drawer-header">
              <div>
                <p className="eyebrow">Downloaded Addon</p>
                <h3>{addonEditorData?.addon.name ?? "Addon editor"}</h3>
              </div>
            </div>

            {addonEditorLoading ? <p className="muted-copy">Loading addon editor...</p> : null}

            {!addonEditorLoading && addonEditorData ? (
              <form className="addon-library-editor-form instance-editor-form" onSubmit={handleSaveAddonEditor}>
                <div className="addon-library-editor-fields instance-editor-fields">
                  <section className="addon-library-editor-section">
                    <div className="addon-library-editor-section-copy">
                      <strong>Link Instances</strong>
                      <span>Select which instances should use this downloaded addon version.</span>
                    </div>

                    {addonEditorData.instances.length === 0 ? (
                      <p className="muted-copy">No instances are available yet.</p>
                    ) : (
                      <div className="addon-selector-list addon-library-instance-selector">
                        {addonEditorData.instances.map((instance) => (
                          <label key={instance.instanceId} className="addon-selector-item">
                            <input
                              type="checkbox"
                              checked={selectedLinkedInstanceIds.includes(instance.instanceId)}
                              disabled={addonEditorSaving}
                              onChange={() => toggleLinkedInstance(instance.instanceId)}
                            />
                            <span>
                              <strong>{instance.friendlyName}</strong>
                              <small>{formatLabel(instance.status)}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="addon-library-editor-section">
                    <div className="addon-library-editor-section-copy">
                      <strong>Linked Instances</strong>
                      <span>Choose whether each linked instance should automatically move to newer downloaded versions.</span>
                    </div>

                    {linkedInstances.length === 0 ? (
                      <p className="muted-copy">No instances are linked to this addon yet.</p>
                    ) : (
                      <div className="addon-library-linked-table" role="table" aria-label="Linked addon instances">
                        <div className="addon-library-linked-header" role="row">
                          <span role="columnheader">Linked Instance</span>
                          <span role="columnheader">Auto Update</span>
                        </div>
                        {linkedInstances.map((instance) => (
                          <article key={instance.instanceId} className="addon-library-linked-row" role="row">
                            <span role="cell">
                              <strong>{instance.friendlyName}</strong>
                              <small>{formatLabel(instance.status)}</small>
                            </span>
                            <span role="cell">
                              <button
                                type="button"
                                className={linkedInstanceAutoUpdates[instance.instanceId] ?? true ? "toggle-switch active" : "toggle-switch"}
                                aria-pressed={linkedInstanceAutoUpdates[instance.instanceId] ?? true}
                                onClick={() => toggleLinkedInstanceAutoUpdate(instance.instanceId)}
                                disabled={addonEditorSaving}
                              >
                                <span className="toggle-switch-thumb" />
                              </button>
                            </span>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="instance-editor-footer">
                  <button type="submit" className="primary-button" disabled={addonEditorSaving}>
                    {addonEditorSaving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="secondary-button" onClick={closeAddonEditor} disabled={addonEditorSaving}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </aside>
        </div>
      ) : null}

      {addonUpdateEditorOpen && addonUpdateSettings ? (
        <div className="instance-editor-drawer-layer">
          <button
            type="button"
            className="instance-editor-drawer-backdrop"
            aria-label="Close addon update schedule editor"
            onClick={() => {
              if (!addonUpdateSettingsSaving) {
                setAddonUpdateEditorOpen(false);
              }
            }}
          />
          <aside className="instance-editor-drawer">
            <div className="instance-editor-drawer-header">
              <div>
                <p className="eyebrow">Addon Updates</p>
                <h3>Schedule</h3>
              </div>
            </div>

            <form className="form-grid instance-editor-form" onSubmit={handleSaveAddonUpdateSettings}>
              <div className="instance-editor-fields">
                <div className="instances-schedule-grid">
                  <label>
                    Check for updates
                    <select
                      value={addonUpdateSettings.updateCheckFrequency}
                      onChange={(event) =>
                        setAddonUpdateSettings((current) =>
                          current
                            ? {
                                ...current,
                                updateCheckFrequency: event.target.value === "weekly" ? "weekly" : "daily",
                              }
                            : current,
                        )
                      }
                      disabled={addonUpdateSettingsSaving}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>

                  <label>
                    Check time
                    <input
                      type="time"
                      value={addonUpdateSettings.updateCheckTime}
                      onChange={(event) =>
                        setAddonUpdateSettings((current) =>
                          current
                            ? {
                                ...current,
                                updateCheckTime: event.target.value,
                              }
                            : current,
                        )
                      }
                      disabled={addonUpdateSettingsSaving}
                    />
                  </label>

                  {addonUpdateSettings.updateCheckFrequency === "weekly" ? (
                    <label>
                      Check day
                      <select
                        value={addonUpdateSettings.updateCheckWeekday}
                        onChange={(event) =>
                          setAddonUpdateSettings((current) =>
                            current
                              ? {
                                  ...current,
                                  updateCheckWeekday: event.target.value as AddonUpdateSettings["updateCheckWeekday"],
                                }
                              : current,
                          )
                        }
                        disabled={addonUpdateSettingsSaving}
                      >
                        <option value="monday">Monday</option>
                        <option value="tuesday">Tuesday</option>
                        <option value="wednesday">Wednesday</option>
                        <option value="thursday">Thursday</option>
                        <option value="friday">Friday</option>
                        <option value="saturday">Saturday</option>
                        <option value="sunday">Sunday</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>

              <div className="instance-editor-footer">
                <button type="submit" className="primary-button" disabled={addonUpdateSettingsSaving}>
                  {addonUpdateSettingsSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setAddonUpdateEditorOpen(false)}
                  disabled={addonUpdateSettingsSaving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </section>
  );
};

export default AddonLibraryPage;
