"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_POSITIONS,
  HistoricalData,
  ModelKind,
  Position,
  RiskResult,
  EfficientFrontierResult,
  calculateRisk,
  calculateEfficientFrontier,
  enrichPositionsWithHistoricalRisk,
  parsePositionsCsv,
} from "../lib/risk";
import {
  type HullWhiteCalibration,
  type RateModelName,
  isHullWhiteStale,
} from "../lib/hull-white";
import { apiUrl } from "../lib/api-client";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const riskSourceLabels = {
  provided: "Provided",
  "historical-pending": "Calculating…",
  historical: "Historical",
  fallback: "Fallback",
} as const;

const riskSourceOrder: Record<NonNullable<Position["riskSource"]> | "sample", number> = {
  "historical-pending": 0,
  historical: 1,
  fallback: 2,
  provided: 3,
  sample: 4,
};

const emptyPositionDraft = {
  symbol: "",
  type: "Stock",
  quantity: "",
  price: "",
  multiplier: "1",
  volatility: "",
  beta: "",
  delta: "",
};

type PortfolioVersion = {
  id: string;
  createdAt: string;
  archivedAt: string | null;
  sourceName: string;
  isDefault: boolean;
  positions: Position[];
};

type MarketBriefing = {
  source: string;
  fetchedAt: string;
  indicators: Array<{
    label: string;
    symbol: string;
    value: number;
    change: number;
    percentChange: number;
    unit: "index" | "percent" | "fx" | "gold" | "oil";
    marketState: string;
    asOf: string;
    trend: number[];
  }>;
  headlines: Array<{ title: string; url: string; publishedAt: string }>;
  warnings: string[];
  disclosures: string[];
};

type SortField =
  | "account"
  | "symbol"
  | "type"
  | "quantity"
  | "price"
  | "marketPrice"
  | "multiplier"
  | "marketValue"
  | "volatility"
  | "beta"
  | "delta"
  | "riskSource";

type PositionSort = {
  field: SortField;
  direction: "asc" | "desc";
};

function MarketSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="market-sparkline-empty">Trend unavailable</span>;
  const width = 92;
  const height = 32;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const points = values.map((value, index) => {
    const x = index / (values.length - 1) * width;
    const y = height - 3 - (value - minimum) / range * (height - 6);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const rising = values.at(-1)! >= values[0];
  return (
    <svg
      className={`market-sparkline ${rising ? "market-sparkline-up" : "market-sparkline-down"}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`30-day trend ${rising ? "up" : "down"}`}
    >
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const MODEL_COPY: Record<ModelKind, { label: string; note: string }> = {
  historical: {
    label: "Historical simulation",
    note: "Replays synchronized adjusted-close market returns.",
  },
  monteCarlo: {
    label: "Monte Carlo",
    note: "10,000 correlated scenarios using a Cholesky factor.",
  },
  parametric: {
    label: "Parametric",
    note: "Delta-normal approximation with portfolio covariance.",
  },
};

function Metric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric ${accent ? "metric-accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EfficientFrontierChart({ data }: { data: EfficientFrontierResult }) {
  const width = 760;
  const height = 340;
  const margin = { top: 22, right: 24, bottom: 46, left: 64 };
  const points = [
    ...data.cloud,
    ...data.frontier,
    data.current,
    ...data.allocationAlternatives.map((alternative) => alternative.point),
  ];
  const maxRisk = Math.max(...points.map((point) => point.risk), 0.01) * 1.08;
  const minReturn = Math.min(...points.map((point) => point.return), 0) - 0.02;
  const maxReturn = Math.max(...points.map((point) => point.return), 0.01) + 0.02;
  const x = (risk: number) => margin.left + risk / maxRisk * (width - margin.left - margin.right);
  const y = (expectedReturn: number) => margin.top +
    (maxReturn - expectedReturn) / (maxReturn - minReturn) * (height - margin.top - margin.bottom);
  const frontierPath = data.frontier.map((point, index) =>
    `${index ? "L" : "M"} ${x(point.risk).toFixed(1)} ${y(point.return).toFixed(1)}`).join(" ");
  const xTicks = Array.from({ length: 5 }, (_, index) => maxRisk * index / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => minReturn + (maxReturn - minReturn) * index / 4);

  return (
    <svg className="frontier-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="frontier-title frontier-description">
      <title id="frontier-title">Efficient frontier and current portfolio</title>
      <desc id="frontier-description">Annualized expected return plotted against annualized volatility. The current portfolio is shown as a highlighted dot.</desc>
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={x(tick)} y1={margin.top} x2={x(tick)} y2={height - margin.bottom} className="frontier-grid" />
          <text x={x(tick)} y={height - 20} textAnchor="middle">{percent.format(tick)}</text>
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={margin.left} y1={y(tick)} x2={width - margin.right} y2={y(tick)} className="frontier-grid" />
          <text x={margin.left - 12} y={y(tick) + 3} textAnchor="end">{percent.format(tick)}</text>
        </g>
      ))}
      {data.cloud.map((point, index) => (
        <circle key={index} cx={x(point.risk)} cy={y(point.return)} r="2.3" className="frontier-cloud" />
      ))}
      <path d={frontierPath} className="frontier-line" />
      <circle cx={x(data.current.risk)} cy={y(data.current.return)} r="7" className="frontier-current-halo" />
      <circle cx={x(data.current.risk)} cy={y(data.current.return)} r="4" className="frontier-current" />
      <text x={x(data.current.risk) + 10} y={y(data.current.return) - 9} className="frontier-current-label">Current portfolio</text>
      {data.allocationAlternatives.map((alternative, index) => (
        <g key={alternative.name}>
          <circle
            cx={x(alternative.point.risk)}
            cy={y(alternative.point.return)}
            r="5"
            className={`frontier-alternative frontier-alternative-${index + 1}`}
          />
          <text
            x={x(alternative.point.risk) + 9}
            y={y(alternative.point.return) + 14 + index * 10}
            className="frontier-alternative-label"
          >
            Alternative {index + 1}
          </text>
        </g>
      ))}
      <text x={width / 2} y={height - 3} textAnchor="middle" className="frontier-axis-label">Annualized volatility</text>
      <text transform={`translate(15 ${height / 2}) rotate(-90)`} textAnchor="middle" className="frontier-axis-label">Expected annual return</text>
    </svg>
  );
}

export function RiskWorkbench() {
  const [positions, setPositions] = useState<Position[]>(DEFAULT_POSITIONS);
  const positionsRef = useRef(positions);
  const [model, setModel] = useState<ModelKind>("historical");
  const [confidence, setConfidence] = useState(0.99);
  const [horizon, setHorizon] = useState(1);
  const [message, setMessage] = useState("Default portfolio loaded; calculating risk factors from history.");
  const [importStatus, setImportStatus] = useState("");
  const [selectedImportFile, setSelectedImportFile] = useState<File>();
  const [importBusy, setImportBusy] = useState(false);
  const [importInputKey, setImportInputKey] = useState(0);
  const [history, setHistory] = useState<HistoricalData>();
  const [marketBriefing, setMarketBriefing] = useState<MarketBriefing>();
  const [marketBriefingError, setMarketBriefingError] = useState("");
  const [marketBriefingRefreshing, setMarketBriefingRefreshing] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("Loading market history…");
  const [remoteResult, setRemoteResult] = useState<RiskResult>();
  const [engineStatus, setEngineStatus] = useState("Connecting to Python engine…");
  const [positionDraft, setPositionDraft] = useState(emptyPositionDraft);
  const [portfolioVersions, setPortfolioVersions] = useState<PortfolioVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [portfolioSaveStatus, setPortfolioSaveStatus] = useState("Loading saved default…");
  const [rateCalibration, setRateCalibration] = useState<HullWhiteCalibration>();
  const [selectedRateModel, setSelectedRateModel] = useState<RateModelName>("Hull-White 1F");
  const [rateModelLoaded, setRateModelLoaded] = useState(false);
  const [rateModelStatus, setRateModelStatus] = useState("Loading stored calibration…");
  const [refreshingRateModel, setRefreshingRateModel] = useState(false);
  const [positionSort, setPositionSort] = useState<PositionSort>();
  const [manualPositionOrder, setManualPositionOrder] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState<string>();
  const [draggedPositionId, setDraggedPositionId] = useState<string>();

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshMarketBriefing(controller.signal);
    return () => controller.abort();
  }, []);

  async function refreshMarketBriefing(signal?: AbortSignal) {
    setMarketBriefingRefreshing(true);
    setMarketBriefingError("");
    try {
      const response = await fetch(apiUrl("/api/market/briefing"), {
        signal,
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail ?? "Market briefing is unavailable.");
      setMarketBriefing(payload as MarketBriefing);
    } catch (error) {
      if (!signal?.aborted) {
        setMarketBriefingError(error instanceof Error ? error.message : "Market briefing is unavailable.");
      }
    } finally {
      if (!signal?.aborted) setMarketBriefingRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiUrl("/api/portfolios"), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load saved portfolios.");
        const versions = payload.versions as PortfolioVersion[];
        setPortfolioVersions(versions);
        const savedDefault = versions.find((version) => version.isDefault);
        if (savedDefault) {
          setPositions(savedDefault.positions.map((position) => ({
            ...position,
            marketPrice: undefined,
            marketPriceAt: undefined,
            marketPriceSource: undefined,
            riskSource: position.riskSource === "provided" ? "provided" : "historical-pending",
          })));
          setPortfolioSaveStatus(`Saved default from ${new Date(savedDefault.createdAt).toLocaleString()}.`);
        } else {
          setPortfolioSaveStatus("Built-in default loaded. It will be archived after the first addition.");
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPortfolioSaveStatus(error instanceof Error ? error.message : "Unable to load saved portfolios.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(apiUrl(`/api/rates?model=${encodeURIComponent(selectedRateModel)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load the interest-rate model.");
        setRateCalibration(payload.calibration as HullWhiteCalibration);
        setRateModelStatus(payload.stale
          ? "Stored calibration is more than 24 hours old."
          : "Stored calibration is current.");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRateModelStatus(error instanceof Error ? error.message : "Unable to load the interest-rate model.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRateModelLoaded(true);
      });
    return () => controller.abort();
  }, [selectedRateModel]);

  const symbolsKey = useMemo(
    () => [...new Set([
      ...positions.map((position) => position.symbol.trim().toUpperCase()),
      "SPY",
    ])]
      .sort()
      .join(","),
    [positions],
  );

  useEffect(() => {
    if (!symbolsKey || !rateModelLoaded) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setHistoryStatus("Loading market history…");
      try {
        const response = await fetch(apiUrl(`/api/history?symbols=${encodeURIComponent(symbolsKey)}`), {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load market history.");
        setHistory(payload as HistoricalData);
        const enriched = enrichPositionsWithHistoricalRisk(
          positionsRef.current,
          payload as HistoricalData,
          new Date(),
          rateCalibration,
        );
        setPositions(enriched);
        setHistoryStatus("Latest eligible prices and market history loaded.");
        try {
          const persistResponse = await fetch(apiUrl("/api/portfolios"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ positions: enriched }),
            signal: controller.signal,
          });
          const persistPayload = await persistResponse.json();
          if (!persistResponse.ok) {
            throw new Error(persistPayload.error ?? "Calculated risk factors could not be saved.");
          }
          setPortfolioVersions(persistPayload.versions as PortfolioVersion[]);
          setPortfolioSaveStatus("Calculated risk factors saved to the current default.");
        } catch (error) {
          if (controller.signal.aborted) return;
          setPortfolioSaveStatus(
            error instanceof Error ? error.message : "Calculated risk factors could not be saved.",
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setHistory(undefined);
        setHistoryStatus(error instanceof Error ? error.message : "Unable to load market history.");
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [symbolsKey, rateCalibration, rateModelLoaded]);

  const continuityResult: RiskResult = useMemo(
    () => calculateRisk(positions, model, confidence, horizon, history),
    [positions, model, confidence, horizon, history],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRemoteResult(undefined);
      setEngineStatus("Connecting to Python engine…");
      try {
        const response = await fetch(apiUrl("/api/risk"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions, model, confidence, horizon }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? payload.detail ?? "Python engine unavailable.");
        setRemoteResult(payload as RiskResult);
        setEngineStatus(
          payload.runId
            ? `Python + SQLAlchemy · audit run ${payload.runId}`
            : "Python + SQLAlchemy",
        );
      } catch {
        if (controller.signal.aborted) return;
        setRemoteResult(undefined);
        setEngineStatus("TypeScript continuity engine");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [positions, model, confidence, horizon]);

  const result = remoteResult ?? continuityResult;
  const diagnosticWarnings = useMemo(() => {
    const warnings: string[] = [];
    const fallbackPositions = positions.filter((position) => position.riskSource === "fallback");
    const pendingPositions = positions.filter((position) => position.riskSource === "historical-pending");
    if (!remoteResult) warnings.push("Python backend is unavailable; the TypeScript continuity engine is active.");
    if (!history) warnings.push("Market history is unavailable, so historical coverage cannot be validated.");
    if (fallbackPositions.length) {
      warnings.push(`${fallbackPositions.length} position${fallbackPositions.length === 1 ? "" : "s"} use fallback risk factors.`);
    }
    if (pendingPositions.length) {
      warnings.push(`${pendingPositions.length} position${pendingPositions.length === 1 ? "" : "s"} still await calculated historical risk factors.`);
    }
    if (model === "historical" && result.observations < 250) {
      warnings.push(`Only ${result.observations.toLocaleString()} synchronized historical scenarios are available; at least 250 are preferred.`);
    }
    if (rateCalibration?.fallbackUsed) {
      warnings.push(`The ${rateCalibration.model} calibration uses governed fallback parameters: ${rateCalibration.fallbackReason ?? "Treasury history was unavailable"}.`);
    }
    if (rateCalibration && rateCalibration.fitRmse > 20) {
      warnings.push(`${rateCalibration.model} curve-factor reconstruction error is ${rateCalibration.fitRmse.toFixed(2)} bp, above the 20 bp review threshold.`);
    }
    if (rateCalibration && rateCalibration.observationCount && rateCalibration.observationCount < 500) {
      warnings.push(`The rate calibration uses only ${rateCalibration.observationCount.toLocaleString()} observations.`);
    }
    return warnings;
  }, [history, model, positions, rateCalibration, remoteResult, result.observations]);
  const rateFitQuality = !rateCalibration
    ? "Unavailable"
    : rateCalibration.fallbackUsed
      ? "Fallback"
      : rateCalibration.fitRmse <= 10
        ? "Strong"
        : rateCalibration.fitRmse <= 20
          ? "Acceptable"
          : "Review";
  const frontier = useMemo(
    () => calculateEfficientFrontier(positions, history),
    [positions, history],
  );
  const displayedPositions = useMemo(
    () => {
      if (positionSort) {
        const direction = positionSort.direction === "asc" ? 1 : -1;
        return [...positions].sort((left, right) => {
          const leftValue = left[positionSort.field] ?? "";
          const rightValue = right[positionSort.field] ?? "";
          const comparison = typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base",
              });
          return comparison * direction || left.symbol.localeCompare(right.symbol);
        });
      }
      if (manualPositionOrder) return positions;
      return positions
        .map((position, index) => ({ position, index }))
        .sort((left, right) =>
          riskSourceOrder[left.position.riskSource ?? "sample"] -
            riskSourceOrder[right.position.riskSource ?? "sample"] ||
          left.index - right.index)
        .map(({ position }) => position);
    },
    [manualPositionOrder, positionSort, positions],
  );

  function togglePositionSort(field: SortField) {
    setPositionSort((current) => current?.field === field
      ? { field, direction: current.direction === "asc" ? "desc" : "asc" }
      : { field, direction: "asc" });
  }

  function sortLabel(label: string, field: SortField) {
    const active = positionSort?.field === field;
    return (
      <button
        className={`sort-header ${active ? "sort-header-active" : ""}`}
        onClick={() => togglePositionSort(field)}
        aria-label={`Sort by ${label}${active ? `, currently ${positionSort.direction}ending` : ""}`}
      >
        {label}
        <span aria-hidden="true">{active ? (positionSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    );
  }

  function movePosition(targetId: string) {
    if (!draggedPositionId || draggedPositionId === targetId) return;
    const ordered = [...displayedPositions];
    const fromIndex = ordered.findIndex((position) => position.id === draggedPositionId);
    const targetIndex = ordered.findIndex((position) => position.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(targetIndex, 0, moved);
    setPositions(ordered);
    setPositionSort(undefined);
    setManualPositionOrder(true);
    setSelectedPositionId(draggedPositionId);
    setDraggedPositionId(undefined);
  }

  function selectPositionFromKeyboard(
    event: KeyboardEvent<HTMLTableRowElement>,
    positionId: string,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedPositionId(positionId);
  }

  function updatePosition(id: string, field: keyof Position, raw: string) {
    setPositions((current) =>
      current.map((position) => {
        if (position.id !== id) return position;
        const updated = {
          ...position,
          [field]:
            field === "symbol" || field === "type" || field === "account"
              ? raw
              : Number(raw) || 0,
        };
        if (field === "quantity" || field === "price" || field === "multiplier") {
          updated.marketValue = Math.abs(
            updated.quantity * updated.price * updated.multiplier,
          );
        }
        if (field === "symbol" || field === "type") {
          updated.marketPrice = undefined;
          updated.marketPriceAt = undefined;
          updated.marketPriceSource = undefined;
          updated.riskSource = "historical-pending";
        }
        if (field === "volatility" || field === "beta" || field === "delta") {
          updated.riskSource = "provided";
        }
        return updated;
      }),
    );
  }

  async function saveDefault(
    nextPositions: Position[],
    previousPositions: Position[],
    sourceName = "Edited portfolio",
  ) {
    const response = await fetch(apiUrl("/api/portfolios"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: nextPositions, previousPositions, sourceName }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to save the portfolio default.");
    const versions = payload.versions as PortfolioVersion[];
    setPortfolioVersions(versions);
    setSelectedVersionId("");
    return versions.find((version) => version.isDefault);
  }

  async function addDraftPosition() {
    const symbol = positionDraft.symbol.trim().toUpperCase();
    const quantity = Number(positionDraft.quantity);
    const price = Number(positionDraft.price);
    const multiplier = Number(positionDraft.multiplier) || 1;
    if (!symbol || !Number.isFinite(quantity) || quantity === 0 ||
        !Number.isFinite(price) || price < 0) {
      setMessage("Enter a symbol, non-zero quantity, and valid unit price before adding.");
      return;
    }
    const hasRiskFactors = [positionDraft.volatility, positionDraft.beta, positionDraft.delta]
      .every((value) => value.trim() !== "" && Number.isFinite(Number(value)));
    const nextPositions: Position[] = [
      ...positions,
      {
        id: crypto.randomUUID(),
        account: "Manual entries",
        symbol,
        type: positionDraft.type,
        quantity,
        price,
        multiplier,
        marketValue: Math.abs(quantity * price * multiplier),
        volatility: hasRiskFactors ? Number(positionDraft.volatility) : 0.25,
        beta: hasRiskFactors ? Number(positionDraft.beta) : 1,
        delta: hasRiskFactors ? Number(positionDraft.delta) : 1,
        riskSource: hasRiskFactors ? "provided" : "historical-pending",
      },
    ];
    setPortfolioSaveStatus("Saving new default and archiving the previous version…");
    try {
      const savedDefault = await saveDefault(nextPositions, positions);
      setPositions(nextPositions);
      setPositionDraft(emptyPositionDraft);
      setPortfolioSaveStatus(`New default saved ${savedDefault ? new Date(savedDefault.createdAt).toLocaleString() : ""}.`);
      setMessage(`${symbol} added. ${hasRiskFactors ? "Provided risk factors retained." : "Calculating risk factors from history."}`);
    } catch (error) {
      setPortfolioSaveStatus(error instanceof Error ? error.message : "Unable to save the portfolio default.");
    }
  }

  async function restorePortfolioVersion() {
    const selected = portfolioVersions.find((version) => version.id === selectedVersionId);
    if (!selected) return;
    setPortfolioSaveStatus("Restoring selected portfolio as the new default…");
    try {
      const restored = selected.positions.map((position) => ({
        ...position,
        riskSource: position.riskSource === "provided" ? "provided" as const : "historical-pending" as const,
      }));
      const savedDefault = await saveDefault(restored, positions, selected.sourceName);
      setPositions(restored);
      setPortfolioSaveStatus(`Restored as new default ${savedDefault ? new Date(savedDefault.createdAt).toLocaleString() : ""}.`);
    } catch (error) {
      setPortfolioSaveStatus(error instanceof Error ? error.message : "Unable to restore the portfolio.");
    }
  }

  async function refreshRateModel() {
    setRefreshingRateModel(true);
    setRateModelStatus("Refreshing the Treasury curve and storing a new calibration…");
    try {
      const response = await fetch(
        apiUrl(`/api/rates?model=${encodeURIComponent(selectedRateModel)}`),
        { method: "POST" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Unable to refresh ${selectedRateModel} calibration.`);
      const calibration = payload.calibration as HullWhiteCalibration;
      setRateCalibration(calibration);
      setPositions((current) => current.map((position) =>
        position.type === "Bond" && position.riskSource !== "provided"
          ? { ...position, riskSource: "historical-pending" as const }
          : position));
      setRateModelStatus(`New ${selectedRateModel} calibration stored successfully.`);
    } catch (error) {
      setRateModelStatus(
        `${error instanceof Error ? error.message : "Refresh failed."} The last valid calibration remains active.`,
      );
    } finally {
      setRefreshingRateModel(false);
    }
  }

  function selectImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSelectedImportFile(file);
    if (file) {
      setImportStatus(`${file.name} selected. Choose Append or Replace.`);
    } else {
      setImportStatus("No file was selected.");
    }
  }

  async function importCsv(mode: "append" | "replace") {
    const file = selectedImportFile;
    if (!file) {
      setImportStatus("Choose a Schwab, Fidelity, or app CSV file first.");
      return;
    }
    await importFile(file, mode);
  }

  async function importFile(file: File, mode: "append" | "replace") {
    if (importBusy) return;
    setImportBusy(true);
    setImportStatus(`Reading ${file.name}…`);
    let parsed: Position[];
    try {
      const accountName = file.name.replace(/\.csv$/i, "");
      parsed = parsePositionsCsv(await file.text(), accountName).map((position) => ({
        ...position,
        id: crypto.randomUUID(),
        sourceFile: file.name,
      }));
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Unable to import CSV.";
      setImportStatus(`Import failed: ${failure}`);
      setMessage(failure);
      setImportBusy(false);
      return;
    }

    const nextPositions = mode === "append" ? [...positions, ...parsed] : parsed;
    setPositions(nextPositions);
    setManualPositionOrder(false);
    setPositionSort(undefined);
    setImportStatus(`${mode === "append" ? "Appending" : "Imported"} ${parsed.length} positions. Saving a new combined position source…`);
    try {
      const savedDefault = await saveDefault(
        nextPositions,
        positions,
        mode === "append" ? `Combined portfolio through ${file.name}` : file.name,
      );
      if (savedDefault) setSelectedVersionId(savedDefault.id);
      setPortfolioSaveStatus(
        `Imported default saved ${savedDefault ? new Date(savedDefault.createdAt).toLocaleString() : ""}.`,
      );
      const accountCount = new Set(nextPositions.map((position) => position.account ?? "Unassigned")).size;
      const confirmation = `${parsed.length} positions ${mode === "append" ? "appended" : "imported"} from ${file.name}. A new combined source now contains ${nextPositions.length} positions across ${accountCount} accounts.`;
      setImportStatus(confirmation);
      setMessage(confirmation);
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Unable to import CSV.";
      setImportStatus(
        `${parsed.length} positions are displayed, but could not be saved as the default: ${failure}`,
      );
      setMessage(`Imported positions are displayed, but persistence failed: ${failure}`);
    }
    setSelectedImportFile(undefined);
    setImportInputKey((current) => current + 1);
    setImportBusy(false);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Market Risk Models home">
          <span className="brand-mark">MR</span>
          <span>
            <strong>Market Risk Models</strong>
            <small>Portfolio intelligence</small>
          </span>
        </a>
        <nav aria-label="Page sections">
          <a href="#overview">Overview</a>
          <a href="#frontier">Efficient frontier</a>
          <a href="#positions">Positions</a>
          <a href="#methodology">Methodology</a>
        </nav>
        <div className="status"><i /> {engineStatus}</div>
      </header>

      <section className="market-briefing" aria-label="Live market briefing">
        <div className="market-indicators">
          {marketBriefing?.indicators.length ? marketBriefing.indicators.map((indicator) => (
            <article key={indicator.symbol}>
              <span>{indicator.label}</span>
              <strong>
                {indicator.unit === "percent"
                  ? `${indicator.value.toFixed(3)}%`
                  : indicator.unit === "fx"
                    ? indicator.value.toFixed(4)
                    : indicator.unit === "gold"
                      ? `$${indicator.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}/oz`
                      : indicator.unit === "oil"
                        ? `$${indicator.value.toFixed(2)}/bbl`
                        : indicator.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </strong>
              <MarketSparkline values={indicator.trend} />
              <small className={indicator.change >= 0 ? "market-up" : "market-down"}>
                {indicator.change >= 0 ? "+" : ""}
                {indicator.unit === "percent"
                  ? `${indicator.change.toFixed(3)} pts`
                  : `${indicator.change.toFixed(2)} (${percent.format(indicator.percentChange)})`}
              </small>
              <em>{indicator.marketState.toLowerCase()} · {new Date(indicator.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</em>
            </article>
          )) : (
            <p className="market-loading">{marketBriefingError || "Loading live market indicators…"}</p>
          )}
        </div>
        <div className="market-headlines">
          <header>
            <span>Yahoo Finance headlines</span>
            <small>{marketBriefing ? `Updated ${new Date(marketBriefing.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Loading…"}</small>
            <button
              type="button"
              onClick={() => void refreshMarketBriefing()}
              disabled={marketBriefingRefreshing}
            >
              {marketBriefingRefreshing ? "Refreshing…" : "Refresh market data"}
            </button>
          </header>
          {marketBriefing?.headlines.length ? (
            <ol>
              {marketBriefing.headlines.slice(0, 5).map((headline) => (
                <li key={headline.url}>
                  <a href={headline.url} target="_blank" rel="noreferrer">{headline.title}</a>
                </li>
              ))}
            </ol>
          ) : <p>{marketBriefingError || "Loading five current headlines…"}</p>}
          {marketBriefing?.warnings.length ? (
            <small className="market-feed-warning">{marketBriefing.warnings.join(" ")}</small>
          ) : null}
        </div>
        <p className="market-disclosure">
          {marketBriefing?.disclosures.join(" ") ?? "Quotes may be delayed. The money-market reading uses the 13-week Treasury-bill yield as a proxy."}
        </p>
      </section>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">Risk workspace / USD base currency</p>
          <h1>See the loss before<br />it becomes the story.</h1>
          <p className="lede">
            Compare transparent risk models across stocks, funds, bonds, and
            options—without hiding the assumptions.
          </p>
        </div>
        <div className="hero-aside">
          <span>Portfolio market value</span>
          <strong>{money.format(result.marketValue)}</strong>
          <small>{positions.length} positions · {result.observations.toLocaleString()} scenarios</small>
        </div>
      </section>

      <section className="controls" aria-label="Risk model controls">
        <div className="control-wide">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={model}
            onChange={(event) => setModel(event.target.value as ModelKind)}
          >
            {Object.entries(MODEL_COPY).map(([value, copy]) => (
              <option key={value} value={value}>{copy.label}</option>
            ))}
          </select>
          <small>{MODEL_COPY[model].note}</small>
        </div>
        <div>
          <label htmlFor="confidence">Confidence</label>
          <select
            id="confidence"
            value={confidence}
            onChange={(event) => setConfidence(Number(event.target.value))}
          >
            <option value={0.95}>95%</option>
            <option value={0.975}>97.5%</option>
            <option value={0.99}>99%</option>
          </select>
        </div>
        <div>
          <label htmlFor="horizon">Horizon</label>
          <select
            id="horizon"
            value={horizon}
            onChange={(event) => setHorizon(Number(event.target.value))}
          >
            <option value={1}>1 day</option>
            <option value={10}>10 days</option>
          </select>
        </div>
        <div className="import-control">
          <label htmlFor="position-file">Position source CSV</label>
          <input
            key={importInputKey}
            id="position-file"
            type="file"
            accept=".csv,text/csv"
            onChange={selectImportFile}
          />
          <button
            type="button"
            disabled={!selectedImportFile || importBusy}
            onClick={() => void importCsv("append")}
          >
            {importBusy ? "Merging…" : "Append selected file"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!selectedImportFile || importBusy}
            onClick={() => void importCsv("replace")}
          >
            Replace portfolio
          </button>
        </div>
      </section>

      {importStatus ? <p className="import-status" role="status">{importStatus}</p> : null}
      <p className="notice" role="status">
        {model === "historical"
          ? remoteResult
            ? `${engineStatus}. ${result.observations.toLocaleString()} persisted observations, ${result.historyStart} to ${result.historyEnd}.`
            : `${historyStatus}${result.historyStart && result.historyEnd
            ? ` ${result.observations.toLocaleString()} overlapping observations, ${result.historyStart} to ${result.historyEnd}. Source: ${history?.source}.`
            : ""}`
          : message}
      </p>

      <section className="rate-model" aria-labelledby="rate-model-title">
        <div>
          <p className="eyebrow">Interest-rate model</p>
          <h2 id="rate-model-title">{selectedRateModel}</h2>
          <p>
            {selectedRateModel === "G2++ 2F"
              ? "Two correlated PCA factors represent level and slope movements, with dynamics estimated from ten years of Treasury curves."
              : "One PCA level factor fits the Treasury curve, with dynamics estimated from ten years of observations."}
          </p>
          <label htmlFor="rate-model-select">Interest-rate model</label>
          <select
            id="rate-model-select"
            value={selectedRateModel}
            onChange={(event) => {
              const nextModel = event.target.value as RateModelName;
              setRateModelLoaded(false);
              setRateModelStatus(`Loading saved ${nextModel} calibration…`);
              setSelectedRateModel(nextModel);
            }}
          >
            <option value="Hull-White 1F">Hull–White one factor</option>
            <option value="G2++ 2F">G2++ two factor</option>
          </select>
        </div>
        {rateCalibration ? (
          <dl>
            <div><dt>Curve date</dt><dd>{new Date(rateCalibration.curveDate).toLocaleDateString()}</dd></div>
            <div><dt>Calibrated</dt><dd>{new Date(rateCalibration.calibratedAt).toLocaleString()}</dd></div>
            <div><dt>Mean reversion (a)</dt><dd>{rateCalibration.meanReversion.toFixed(3)} /yr</dd></div>
            <div><dt>Volatility (σ)</dt><dd>{percent.format(rateCalibration.volatility)}</dd></div>
            {rateCalibration.model === "G2++ 2F" ? (
              <>
                <div><dt>Second mean reversion (b)</dt><dd>{(rateCalibration.secondFactorMeanReversion ?? 0).toFixed(3)} /yr</dd></div>
                <div><dt>Second volatility (η)</dt><dd>{percent.format(rateCalibration.secondFactorVolatility ?? 0)}</dd></div>
                <div><dt>Factor correlation (ρ)</dt><dd>{(rateCalibration.factorCorrelation ?? 0).toFixed(2)}</dd></div>
              </>
            ) : null}
            <div><dt>Curve nodes</dt><dd>{rateCalibration.curve.length}</dd></div>
            <div><dt>Parameter source</dt><dd>{rateCalibration.calibrationSource ?? (rateCalibration.parameterSource === "governed-default" ? "Governed default" : rateCalibration.parameterSource)}</dd></div>
            {rateCalibration.calibrationObjective ? (
              <div><dt>Method</dt><dd>{rateCalibration.calibrationObjective}</dd></div>
            ) : null}
            {rateCalibration.observationCount ? (
              <div><dt>Observations</dt><dd>{rateCalibration.observationCount.toLocaleString()}</dd></div>
            ) : null}
            {rateCalibration.calibrationWindowStart && rateCalibration.calibrationWindowEnd ? (
              <div><dt>Calibration window</dt><dd>{rateCalibration.calibrationWindowStart} to {rateCalibration.calibrationWindowEnd}</dd></div>
            ) : null}
            {rateCalibration.meanReversionConfidenceInterval ? (
              <div><dt>a 95% interval</dt><dd>{rateCalibration.meanReversionConfidenceInterval.map((value) => value.toFixed(3)).join("–")} /yr</dd></div>
            ) : null}
            {rateCalibration.secondFactorMeanReversionConfidenceInterval ? (
              <div><dt>b 95% interval</dt><dd>{rateCalibration.secondFactorMeanReversionConfidenceInterval.map((value) => value.toFixed(3)).join("–")} /yr</dd></div>
            ) : null}
            <div><dt>Historical fit RMSE</dt><dd>{rateCalibration.fitRmse.toFixed(2)} bp</dd></div>
            {rateCalibration.fallbackUsed ? (
              <div><dt>Fallback</dt><dd>Yes — {rateCalibration.fallbackReason ?? "historical calibration unavailable"}</dd></div>
            ) : null}
          </dl>
        ) : <p className="rate-model-empty">No valid stored calibration is available.</p>}
        <div className="rate-model-action">
          <button
            className="secondary"
            onClick={refreshRateModel}
            disabled={refreshingRateModel}
          >
            {refreshingRateModel ? "Refreshing…" : `Refresh ${selectedRateModel}`}
          </button>
          <small className={rateCalibration && isHullWhiteStale(rateCalibration) ? "stale" : ""}>
            {rateModelStatus}
          </small>
        </div>
      </section>

      <details className="diagnostics panel" id="diagnostics">
        <summary>
          <span>
            <span className="eyebrow">Backend model governance</span>
            <strong>Fit quality & data diagnostics</strong>
          </span>
          <span className={`diagnostic-overall ${diagnosticWarnings.length ? "diagnostic-review" : "diagnostic-healthy"}`}>
            {diagnosticWarnings.length ? `${diagnosticWarnings.length} item${diagnosticWarnings.length === 1 ? "" : "s"} to review` : "No active warnings"}
          </span>
        </summary>
        <div className="diagnostic-grid">
          <article>
            <header><span>Risk engine</span><strong>{remoteResult ? "Connected" : "Continuity mode"}</strong></header>
            <dl>
              <div><dt>Backend</dt><dd>{remoteResult ? "Python + SQLAlchemy" : "TypeScript fallback"}</dd></div>
              <div><dt>Active model</dt><dd>{MODEL_COPY[model].label}</dd></div>
              <div><dt>Scenarios</dt><dd>{result.observations.toLocaleString()}</dd></div>
              <div><dt>Coverage</dt><dd>{result.historyStart && result.historyEnd ? `${result.historyStart} to ${result.historyEnd}` : "Unavailable"}</dd></div>
              <div><dt>Audit record</dt><dd>{result.runId ? `Run ${result.runId}` : "Not persisted"}</dd></div>
            </dl>
          </article>
          <article>
            <header><span>Interest-rate fit</span><strong className={`fit-${rateFitQuality.toLowerCase()}`}>{rateFitQuality}</strong></header>
            <dl>
              <div><dt>Model</dt><dd>{rateCalibration?.model ?? "Unavailable"}</dd></div>
              <div><dt>Fit RMSE</dt><dd>{rateCalibration ? `${rateCalibration.fitRmse.toFixed(2)} bp` : "Unavailable"}</dd></div>
              <div><dt>Observations</dt><dd>{rateCalibration?.observationCount?.toLocaleString() ?? "Unavailable"}</dd></div>
              <div><dt>Window</dt><dd>{rateCalibration?.calibrationWindowStart && rateCalibration.calibrationWindowEnd ? `${rateCalibration.calibrationWindowStart} to ${rateCalibration.calibrationWindowEnd}` : "Unavailable"}</dd></div>
              <div><dt>Method</dt><dd>{rateCalibration?.calibrationObjective ?? "Governed parameters"}</dd></div>
            </dl>
          </article>
          <article>
            <header><span>Market data</span><strong>{history ? "Loaded" : "Unavailable"}</strong></header>
            <dl>
              <div><dt>Price source</dt><dd>{history?.source ?? "Unavailable"}</dd></div>
              <div><dt>Series loaded</dt><dd>{history?.series.length.toLocaleString() ?? "0"}</dd></div>
              <div><dt>Fetched</dt><dd>{history?.fetchedAt ? new Date(history.fetchedAt).toLocaleString() : "Unavailable"}</dd></div>
              <div><dt>Rate source</dt><dd>{rateCalibration?.curveSource ?? "Unavailable"}</dd></div>
              <div><dt>Persistence</dt><dd>SQLite market cache and portfolio versions</dd></div>
            </dl>
          </article>
        </div>
        <div className="diagnostic-warnings">
          <h3>Data-quality warnings</h3>
          {diagnosticWarnings.length ? (
            <ul>{diagnosticWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          ) : (
            <p>No current backend fit or data-coverage warning crossed its review threshold.</p>
          )}
          <small>Thresholds: rate-factor RMSE above 20 bp, fewer than 500 rate observations, fewer than 250 synchronized historical scenarios, fallback parameters, pending risk factors, or unavailable Python/history services.</small>
        </div>
      </details>

      <section className="metrics" id="overview">
        <Metric
          label={`${percent.format(confidence)} value at risk`}
          value={money.format(result.var)}
          detail={`${percent.format(result.var / result.marketValue)} of portfolio`}
          accent
        />
        <Metric
          label="Expected shortfall"
          value={money.format(result.expectedShortfall)}
          detail="Average loss beyond VaR"
        />
        <Metric
          label="Daily volatility"
          value={money.format(result.dailyVolatility)}
          detail={`${percent.format(result.dailyVolatility / result.marketValue)} normalized`}
        />
        <Metric
          label="Diversification benefit"
          value={money.format(result.diversificationBenefit)}
          detail="Standalone minus portfolio VaR"
        />
      </section>

      <section className="analysis-grid">
        <article className="panel loss-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Loss distribution</p>
              <h2>Scenario range</h2>
            </div>
            <span className="model-pill">{MODEL_COPY[model].label}</span>
          </div>
          <div className="histogram" aria-label="Profit and loss distribution">
            {result.histogram.map((height, index) => (
              <i
                key={index}
                style={{ height: `${Math.max(5, height * 100)}%` }}
                className={index < 5 ? "tail" : ""}
              />
            ))}
            <b style={{ left: `${result.varMarker}%` }}>
              <span>VaR</span>
            </b>
          </div>
          <div className="plot-legend loss-legend" aria-label="Loss distribution legend">
            <span><i className="legend-swatch legend-observation" />Observations</span>
            <span><i className="legend-swatch legend-tail" />Tail observations</span>
            <span><i className="legend-line legend-var" />Value at Risk</span>
          </div>
          <div className="axis">
            <span>{money.format(-result.range)}</span>
            <span>$0</span>
            <span>{money.format(result.range)}</span>
          </div>
          <div className="callout">
            <strong>Interpretation</strong>
            <p>
              At {percent.format(confidence)} confidence, the portfolio is not
              expected to lose more than {money.format(result.var)} over{" "}
              {horizon === 1 ? "one trading day" : "ten trading days"} under
              this model.
            </p>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Risk concentration</p>
              <h2>Top contributors</h2>
            </div>
          </div>
          <div className="contributors">
            {result.contributions.slice(0, 6).map((item, index) => (
              <div className="contributor" key={item.id}>
                <span className="rank">0{index + 1}</span>
                <div>
                  <strong>{item.symbol}</strong>
                  <small>{item.type}</small>
                </div>
                <div className="bar"><i style={{ width: `${item.share * 100}%` }} /></div>
                <b>{percent.format(item.share)}</b>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="frontier panel" id="frontier">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Portfolio construction</p>
            <h2>Efficient frontier</h2>
          </div>
          {frontier && <span className="model-pill">{frontier.assetCount} mapped assets</span>}
        </div>
        {frontier ? (
          <>
            <EfficientFrontierChart data={frontier} />
            <div className="plot-legend frontier-legend" aria-label="Efficient frontier legend">
              <span><i className="legend-dot legend-cloud" />Opportunity set</span>
              <span><i className="legend-line legend-frontier" />Efficient frontier</span>
              <span><i className="legend-dot legend-current" />Current portfolio</span>
              <span><i className="legend-dot legend-alternative-1" />Alternative 1</span>
              <span><i className="legend-dot legend-alternative-2" />Alternative 2</span>
            </div>
            <div className="frontier-summary">
              <span><b>{percent.format(frontier.current.return)}</b> expected return</span>
              <span><b>{percent.format(frontier.current.risk)}</b> volatility</span>
              <span><b>{frontier.current.sharpe.toFixed(2)}</b> Sharpe ratio</span>
              <span>{frontier.observations.toLocaleString()} overlapping daily returns</span>
            </div>
            <div className="frontier-candidates">
              <div>
                <p className="eyebrow">Largest model allocation gaps</p>
                <h3>Top 5 rebalancing candidates</h3>
              </div>
              <ol>
                {frontier.recommendations.map((candidate) => (
                  <li key={candidate.symbol}>
                    <strong>{candidate.symbol}</strong>
                    <span className={candidate.action === "Increase" ? "candidate-increase" : "candidate-reduce"}>
                      {candidate.action}
                    </span>
                    <small>
                      {percent.format(candidate.currentWeight)} current →{" "}
                      {percent.format(candidate.targetWeight)} model target
                    </small>
                  </li>
                ))}
              </ol>
            </div>
            <div className="allocation-alternatives">
              <div className="allocation-alternatives-heading">
                <p className="eyebrow">Incremental allocation ideas</p>
                <h3>Two approximately 13% changes</h3>
                <p>
                  Both retain 87% of the current mapped allocation, tilt 10%
                  toward the maximum-Sharpe portfolio, and reserve 3% for a
                  small deterministic randomized change.
                </p>
              </div>
              {frontier.allocationAlternatives.map((alternative, index) => (
                <article key={alternative.name}>
                  <header>
                    <span>Alternative {index + 1}</span>
                    <strong>{alternative.name}</strong>
                  </header>
                  <p>{alternative.description}</p>
                  <dl>
                    <div><dt>Turnover</dt><dd>{percent.format(alternative.turnover)}</dd></div>
                    <div><dt>Return</dt><dd>{percent.format(alternative.point.return)}</dd></div>
                    <div><dt>Volatility</dt><dd>{percent.format(alternative.point.risk)}</dd></div>
                    <div><dt>Sharpe</dt><dd>{alternative.point.sharpe.toFixed(2)}</dd></div>
                  </dl>
                  <ol>
                    {alternative.changes.map((change) => (
                      <li key={change.symbol}>
                        <strong>{change.symbol}</strong>
                        <span className={change.change >= 0 ? "candidate-increase" : "candidate-reduce"}>
                          {change.change >= 0 ? "+" : ""}{percent.format(change.change)}
                        </span>
                        <small>
                          {percent.format(change.currentWeight)} →{" "}
                          {percent.format(change.proposedWeight)}
                        </small>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
            <p className="frontier-note">
              Long-only simulated portfolios form the opportunity set and upper frontier.
              The current portfolio dot uses normalized positive mapped
              delta-adjusted exposure; hedge exposures are excluded from the
              long-only allocation comparison.
              Rebalancing candidates are the largest exposure gaps versus the simulated
              maximum-Sharpe portfolio, not investment recommendations.
              {frontier.excluded.length
                ? ` Excluded for insufficient history: ${frontier.excluded.join(", ")}.`
                : ""}
            </p>
          </>
        ) : (
          <p className="frontier-loading">Loading enough overlapping history to construct the frontier…</p>
        )}
      </section>

      <section className="positions panel" id="positions">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Portfolio input</p>
            <h2>Positions & sensitivities</h2>
          </div>
          <div className="portfolio-history">
            <select
              aria-label="Position source files"
              value={selectedVersionId}
              onChange={(event) => setSelectedVersionId(event.target.value)}
            >
              <option value="">Position source files</option>
              {portfolioVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.sourceName}{version.isDefault ? " · current default" : ""} ·{" "}
                  {new Date(version.archivedAt ?? version.createdAt).toLocaleString()} ·{" "}
                  {version.positions.length} positions
                </option>
              ))}
            </select>
            <button
              className="secondary"
              disabled={!selectedVersionId ||
                portfolioVersions.find((version) => version.id === selectedVersionId)?.isDefault}
              onClick={restorePortfolioVersion}
            >
              Use as default
            </button>
          </div>
        </div>
        {importStatus ? <p className="portfolio-import-status" role="status">{importStatus}</p> : null}
        <p className="portfolio-save-status" role="status">{portfolioSaveStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="move-column" aria-label="Move position" />
                <th aria-sort={positionSort?.field === "account" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Account", "account")}</th>
                <th aria-sort={positionSort?.field === "symbol" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Symbol", "symbol")}</th>
                <th aria-sort={positionSort?.field === "type" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Instrument", "type")}</th>
                <th aria-sort={positionSort?.field === "quantity" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Quantity", "quantity")}</th>
                <th aria-sort={positionSort?.field === "price" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Unit price", "price")}</th>
                <th aria-sort={positionSort?.field === "marketPrice" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Market price", "marketPrice")}</th>
                <th aria-sort={positionSort?.field === "multiplier" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Multiplier", "multiplier")}</th>
                <th aria-sort={positionSort?.field === "marketValue" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Market value", "marketValue")}</th>
                <th aria-sort={positionSort?.field === "volatility" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Annual vol.", "volatility")}</th>
                <th aria-sort={positionSort?.field === "beta" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Beta", "beta")}</th>
                <th aria-sort={positionSort?.field === "delta" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Delta", "delta")}</th>
                <th aria-sort={positionSort?.field === "riskSource" ? `${positionSort.direction}ending` : "none"}>{sortLabel("Risk source", "riskSource")}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <tr className="position-draft">
                <td className="move-column" />
                <td>Manual entries</td>
                <td><input aria-label="New position symbol" placeholder="Symbol" value={positionDraft.symbol} onChange={(event) => setPositionDraft({ ...positionDraft, symbol: event.target.value.toUpperCase() })} /></td>
                <td>
                  <select aria-label="New position instrument type" value={positionDraft.type} onChange={(event) => setPositionDraft({ ...positionDraft, type: event.target.value })}>
                    {["Stock", "ETF", "Mutual Fund", "Bond", "Stock Option", "ETF Option", "Bond Option"].map((type) => <option key={type}>{type}</option>)}
                  </select>
                </td>
                <td><input aria-label="New position quantity" placeholder="0" type="number" value={positionDraft.quantity} onChange={(event) => setPositionDraft({ ...positionDraft, quantity: event.target.value })} /></td>
                <td><input aria-label="New position unit price" placeholder="0.00" type="number" min="0" step="0.01" value={positionDraft.price} onChange={(event) => setPositionDraft({ ...positionDraft, price: event.target.value })} /></td>
                <td><span className="market-quote market-quote-empty">After add</span></td>
                <td><input aria-label="New position multiplier" type="number" min="0" step="1" value={positionDraft.multiplier} onChange={(event) => setPositionDraft({ ...positionDraft, multiplier: event.target.value })} /></td>
                <td><input aria-label="New position market value" type="number" readOnly value={
                  positionDraft.quantity && positionDraft.price
                    ? Math.abs(Number(positionDraft.quantity) * Number(positionDraft.price) * (Number(positionDraft.multiplier) || 1))
                    : ""
                } /></td>
                <td><input aria-label="New position volatility" placeholder="Auto" type="number" min="0" step="0.01" value={positionDraft.volatility} onChange={(event) => setPositionDraft({ ...positionDraft, volatility: event.target.value })} /></td>
                <td><input aria-label="New position beta" placeholder="Auto" type="number" step="0.1" value={positionDraft.beta} onChange={(event) => setPositionDraft({ ...positionDraft, beta: event.target.value })} /></td>
                <td><input aria-label="New position delta" placeholder="Auto" type="number" step="0.05" value={positionDraft.delta} onChange={(event) => setPositionDraft({ ...positionDraft, delta: event.target.value })} /></td>
                <td><span className="risk-source risk-source-historical-pending">Auto / provided</span></td>
                <td><button className="add-row" onClick={addDraftPosition}>Add</button></td>
              </tr>
              {displayedPositions.map((position) => (
                <tr
                  key={position.id}
                  className={[
                    selectedPositionId === position.id ? "position-selected" : "",
                    draggedPositionId === position.id ? "position-dragging" : "",
                  ].filter(Boolean).join(" ")}
                  aria-selected={selectedPositionId === position.id}
                  tabIndex={0}
                  onClick={() => setSelectedPositionId(position.id)}
                  onKeyDown={(event) => selectPositionFromKeyboard(event, position.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => movePosition(position.id)}
                >
                  <td className="move-column">
                    <button
                      className="drag-handle"
                      draggable
                      aria-label={`Drag to move ${position.symbol}`}
                      title="Drag to reorder"
                      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", position.id);
                        setDraggedPositionId(position.id);
                      }}
                      onDragEnd={() => setDraggedPositionId(undefined)}
                    >
                      ⠿
                    </button>
                  </td>
                  <td><input aria-label={`${position.symbol} account`} value={position.account ?? "Unassigned"} onChange={(e) => updatePosition(position.id, "account", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} symbol`} value={position.symbol} onChange={(e) => updatePosition(position.id, "symbol", e.target.value.toUpperCase())} /></td>
                  <td>
                    <select aria-label={`${position.symbol} instrument type`} value={position.type} onChange={(e) => updatePosition(position.id, "type", e.target.value)}>
                      {["Stock", "ETF", "Mutual Fund", "Bond", "Stock Option", "ETF Option", "Bond Option"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`${position.symbol} quantity`} type="number" value={position.quantity} onChange={(e) => updatePosition(position.id, "quantity", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} unit price`} type="number" min="0" step="0.01" value={position.price} onChange={(e) => updatePosition(position.id, "price", e.target.value)} /></td>
                  <td>
                    {position.marketPrice !== undefined ? (
                      <span className="market-quote">
                        <strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(position.marketPrice)}</strong>
                        <em>{
                          position.marketPriceSource === "black-scholes"
                            ? "Black–Scholes fallback"
                            : position.marketPriceSource === "hull-white"
                              ? `${rateCalibration?.model ?? "Rate model"} option`
                            : position.marketPriceSource === "treasury-curve"
                              ? `${rateCalibration?.model ?? "Rate model"} curve`
                              : "Market quote"
                        }</em>
                        <small>{position.marketPriceAt
                          ? new Date(position.marketPriceAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                          : "Latest available"}</small>
                      </span>
                    ) : (
                      <span className="market-quote market-quote-empty">Unavailable</span>
                    )}
                  </td>
                  <td><input aria-label={`${position.symbol} multiplier`} type="number" min="0" step="1" value={position.multiplier} onChange={(e) => updatePosition(position.id, "multiplier", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} market value`} type="number" value={position.marketValue} readOnly /></td>
                  <td><input aria-label={`${position.symbol} volatility`} type="number" min="0" step="0.01" value={position.volatility} onChange={(e) => updatePosition(position.id, "volatility", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} beta`} type="number" step="0.1" value={position.beta} onChange={(e) => updatePosition(position.id, "beta", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} delta`} type="number" step="0.05" value={position.delta} onChange={(e) => updatePosition(position.id, "delta", e.target.value)} /></td>
                  <td>
                    <span
                      className={`risk-source risk-source-${position.riskSource ?? "sample"}`}
                      title={
                        position.riskSource === "historical"
                          ? "Calculated from historical adjusted-close returns"
                          : position.riskSource === "fallback"
                            ? "Estimated because sufficient history was unavailable"
                            : position.riskSource === "provided"
                              ? "Supplied by the file or edited by the user"
                              : position.riskSource === "historical-pending"
                                ? "Waiting for historical market data"
                                : "Illustrative assumption in the default sample portfolio"
                      }
                    >
                      {position.riskSource ? riskSourceLabels[position.riskSource] : "Sample"}
                    </span>
                  </td>
                  <td><button className="remove" aria-label={`Remove ${position.symbol}`} onClick={() => setPositions((current) => current.filter((item) => item.id !== position.id))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          Click a column heading to sort; click a row to select it. Drag the
          handle at the left edge to create a manual row order.
          {" "}
          CSV columns: symbol, type, quantity, price, multiplier, marketValue,
          volatility, beta, delta. Market value is quantity × unit price ×
          multiplier; option contracts use 100. Sample prices and option
          premiums remain illustrative when no exact tradable identifier is available.
          Stock, ETF, and mutual-fund prices refresh from the latest market feed.
          Stock and ETF options without quotes use a labeled Black–Scholes fallback;
          simplified option symbols assume 90 days to expiration.
          Generic Treasury rows use the selected stored interest-rate model’s initial discount curve;
          mean reversion and volatility are retained for rate scenarios and
          fixed-income option pricing.
          Delta is 1.0 for cash instruments.
          Risk source identifies calculated, supplied, fallback, and sample values.
        </p>
      </section>

      <section className="methodology" id="methodology">
        <p className="eyebrow">Model governance</p>
        <h2>Every number should explain itself.</h2>
        <div>
          <article><span>01</span><h3>Exposure mapping</h3><p>Options use delta-adjusted exposure. Treasury prices use the selected persisted rate-model curve; historical ETF proxies currently supply bond return risk.</p></article>
          <article><span>02</span><h3>Dependence</h3><p>Correlations are produced from a one-factor market structure, repaired to positive definiteness, then decomposed by Cholesky.</p></article>
          <article><span>03</span><h3>Tail measurement</h3><p>VaR is a loss quantile. Expected Shortfall is the mean of losses beyond that quantile and remains visible for every model.</p></article>
        </div>
        <aside>
          <strong>Important limitation</strong>
          <p>The preferred engine is Python with SQLAlchemy persistence; this hosted interface retains a TypeScript continuity engine until a Python service URL is configured. This is not investment advice or a production risk limit system. Independently validate data and models before financial use.</p>
        </aside>
      </section>

      <footer>
        <span>Market Risk Models</span>
        <p>Transparent analytics for better risk conversations.</p>
        <small>Model version 0.2.0 · Python-first, portable, and auditable.</small>
      </footer>
    </main>
  );
}
