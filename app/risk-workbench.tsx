"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
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
  const points = [...data.cloud, ...data.frontier, data.current];
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
      <text x={width / 2} y={height - 3} textAnchor="middle" className="frontier-axis-label">Annualized volatility</text>
      <text transform={`translate(15 ${height / 2}) rotate(-90)`} textAnchor="middle" className="frontier-axis-label">Expected annual return</text>
    </svg>
  );
}

export function RiskWorkbench() {
  const [positions, setPositions] = useState<Position[]>(DEFAULT_POSITIONS);
  const [model, setModel] = useState<ModelKind>("historical");
  const [confidence, setConfidence] = useState(0.99);
  const [horizon, setHorizon] = useState(1);
  const [message, setMessage] = useState("Default portfolio loaded; calculating risk factors from history.");
  const [history, setHistory] = useState<HistoricalData>();
  const [historyStatus, setHistoryStatus] = useState("Loading market history…");
  const [remoteResult, setRemoteResult] = useState<RiskResult>();
  const [engineStatus, setEngineStatus] = useState("Connecting to Python engine…");

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
    if (!symbolsKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setHistoryStatus("Loading market history…");
      try {
        const response = await fetch(`/api/history?symbols=${encodeURIComponent(symbolsKey)}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load market history.");
        setHistory(payload as HistoricalData);
        setPositions((current) => enrichPositionsWithHistoricalRisk(current, payload as HistoricalData));
        setHistoryStatus("Market history loaded.");
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
  }, [symbolsKey]);

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
        const response = await fetch("/api/risk", {
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
  const frontier = useMemo(
    () => calculateEfficientFrontier(positions, history),
    [positions, history],
  );
  const displayedPositions = useMemo(
    () => positions
      .map((position, index) => ({ position, index }))
      .sort((left, right) =>
        riskSourceOrder[left.position.riskSource ?? "sample"] -
          riskSourceOrder[right.position.riskSource ?? "sample"] ||
        left.index - right.index)
      .map(({ position }) => position),
    [positions],
  );

  function updatePosition(id: string, field: keyof Position, raw: string) {
    setPositions((current) =>
      current.map((position) => {
        if (position.id !== id) return position;
        const updated = {
          ...position,
          [field]:
            field === "symbol" || field === "type"
              ? raw
              : Number(raw) || 0,
        };
        if (field === "quantity" || field === "price" || field === "multiplier") {
          updated.marketValue = Math.abs(
            updated.quantity * updated.price * updated.multiplier,
          );
        }
        if (field === "volatility" || field === "beta" || field === "delta") {
          updated.riskSource = "provided";
        }
        return updated;
      }),
    );
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parsePositionsCsv(await file.text());
      setPositions(parsed);
      setMessage(`${parsed.length} positions imported from ${file.name}. Broker files use estimated risk sensitivities.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to import CSV.");
    }
    event.target.value = "";
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
        <label className="upload">
          Import Schwab, Fidelity, or app CSV
          <input type="file" accept=".csv,text/csv" onChange={importCsv} />
        </label>
      </section>

      <p className="notice" role="status">
        {model === "historical"
          ? remoteResult
            ? `${engineStatus}. ${result.observations.toLocaleString()} persisted observations, ${result.historyStart} to ${result.historyEnd}.`
            : `${historyStatus}${result.historyStart && result.historyEnd
            ? ` ${result.observations.toLocaleString()} overlapping observations, ${result.historyStart} to ${result.historyEnd}. Source: ${history?.source}.`
            : ""}`
          : message}
      </p>

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
            <p className="frontier-note">
              Long-only simulated portfolios form the opportunity set and upper frontier.
              The current portfolio dot uses position market values and delta-adjusted option exposure.
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
          <button
            className="secondary"
            onClick={() =>
              setPositions((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  symbol: "NEW",
                  type: "Stock",
                  quantity: 100,
                  price: 100,
                  multiplier: 1,
                  marketValue: 10000,
                  volatility: 0.25,
                  beta: 1,
                  delta: 1,
                  riskSource: "provided",
                },
              ])
            }
          >
            + Add position
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Instrument</th>
                <th>Quantity</th>
                <th>Unit price</th>
                <th>Multiplier</th>
                <th>Market value</th>
                <th>Annual vol.</th>
                <th>Beta</th>
                <th>Delta</th>
                <th>Risk source</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {displayedPositions.map((position) => (
                <tr key={position.id}>
                  <td><input aria-label={`${position.symbol} symbol`} value={position.symbol} onChange={(e) => updatePosition(position.id, "symbol", e.target.value.toUpperCase())} /></td>
                  <td>
                    <select aria-label={`${position.symbol} instrument type`} value={position.type} onChange={(e) => updatePosition(position.id, "type", e.target.value)}>
                      {["Stock", "ETF", "Mutual Fund", "Bond", "Stock Option", "ETF Option", "Bond Option"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`${position.symbol} quantity`} type="number" value={position.quantity} onChange={(e) => updatePosition(position.id, "quantity", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} unit price`} type="number" min="0" step="0.01" value={position.price} onChange={(e) => updatePosition(position.id, "price", e.target.value)} /></td>
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
          CSV columns: symbol, type, quantity, price, multiplier, marketValue,
          volatility, beta, delta. Market value is quantity × unit price ×
          multiplier; option contracts use 100. Sample prices and option
          premiums are illustrative and editable. Delta is 1.0 for cash instruments.
          Risk source identifies calculated, supplied, fallback, and sample values.
        </p>
      </section>

      <section className="methodology" id="methodology">
        <p className="eyebrow">Model governance</p>
        <h2>Every number should explain itself.</h2>
        <div>
          <article><span>01</span><h3>Exposure mapping</h3><p>Options use delta-adjusted exposure. Bonds use their supplied volatility and beta proxy until curve-factor data is connected.</p></article>
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
