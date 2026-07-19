"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_POSITIONS,
  HistoricalData,
  ModelKind,
  Position,
  RiskResult,
  calculateRisk,
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

export function RiskWorkbench() {
  const [positions, setPositions] = useState<Position[]>(DEFAULT_POSITIONS);
  const [model, setModel] = useState<ModelKind>("historical");
  const [confidence, setConfidence] = useState(0.99);
  const [horizon, setHorizon] = useState(1);
  const [message, setMessage] = useState("Sample diversified portfolio loaded.");
  const [history, setHistory] = useState<HistoricalData>();
  const [historyStatus, setHistoryStatus] = useState("Loading market history…");

  const symbolsKey = useMemo(
    () => [...new Set(positions.map((position) => position.symbol.trim().toUpperCase()))]
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

  const result: RiskResult = useMemo(
    () => calculateRisk(positions, model, confidence, horizon, history),
    [positions, model, confidence, horizon, history],
  );

  function updatePosition(id: string, field: keyof Position, raw: string) {
    setPositions((current) =>
      current.map((position) =>
        position.id === id
          ? {
              ...position,
              [field]:
                field === "symbol" || field === "type"
                  ? raw
                  : Number(raw) || 0,
            }
          : position,
      ),
    );
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parsePositionsCsv(await file.text());
      setPositions(parsed);
      setMessage(`${parsed.length} positions imported from ${file.name}.`);
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
          <a href="#positions">Positions</a>
          <a href="#methodology">Methodology</a>
        </nav>
        <div className="status"><i /> Model ready</div>
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
          Import CSV
          <input type="file" accept=".csv,text/csv" onChange={importCsv} />
        </label>
      </section>

      <p className="notice" role="status">
        {model === "historical"
          ? `${historyStatus}${result.historyStart && result.historyEnd
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
                  marketValue: 10000,
                  volatility: 0.25,
                  beta: 1,
                  delta: 1,
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
                <th>Market value</th>
                <th>Annual vol.</th>
                <th>Beta</th>
                <th>Delta</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id}>
                  <td><input aria-label={`${position.symbol} symbol`} value={position.symbol} onChange={(e) => updatePosition(position.id, "symbol", e.target.value.toUpperCase())} /></td>
                  <td>
                    <select aria-label={`${position.symbol} instrument type`} value={position.type} onChange={(e) => updatePosition(position.id, "type", e.target.value)}>
                      {["Stock", "ETF", "Mutual Fund", "Bond", "Stock Option", "ETF Option", "Bond Option"].map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </td>
                  <td><input aria-label={`${position.symbol} market value`} type="number" value={position.marketValue} onChange={(e) => updatePosition(position.id, "marketValue", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} volatility`} type="number" min="0" step="0.01" value={position.volatility} onChange={(e) => updatePosition(position.id, "volatility", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} beta`} type="number" step="0.1" value={position.beta} onChange={(e) => updatePosition(position.id, "beta", e.target.value)} /></td>
                  <td><input aria-label={`${position.symbol} delta`} type="number" step="0.05" value={position.delta} onChange={(e) => updatePosition(position.id, "delta", e.target.value)} /></td>
                  <td><button className="remove" aria-label={`Remove ${position.symbol}`} onClick={() => setPositions((current) => current.filter((item) => item.id !== position.id))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          CSV columns: symbol, type, marketValue, volatility, beta, delta.
          Volatility uses decimals (0.25 = 25%). Delta is 1.0 for cash instruments.
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
          <p>This first release uses deterministic synthetic market histories for demonstration. It is not investment advice or a production risk limit system. Connect validated market data and independently validate models before financial use.</p>
        </aside>
      </section>

      <footer>
        <span>Market Risk Models</span>
        <p>Transparent analytics for better risk conversations.</p>
        <small>Model version 0.1.0 · Built for review, testing, and extension.</small>
      </footer>
    </main>
  );
}
