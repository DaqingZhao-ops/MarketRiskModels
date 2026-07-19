import { NextResponse } from "next/server";

import {
  createPortfolioVersionsIndex,
  createPortfolioVersionsTable,
} from "../../../db/schema";
import type { Position } from "../../../lib/risk";

type D1Result<T> = { results?: T[] };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  run: () => Promise<unknown>;
  all: <T>() => Promise<D1Result<T>>;
};
type D1Database = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};
type PortfolioRow = {
  id: string;
  created_at: string;
  archived_at: string | null;
  positions_json: string;
  source_name: string;
  is_default: number;
};

async function database() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1Database }).DB;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(createPortfolioVersionsTable),
    db.prepare(createPortfolioVersionsIndex),
  ]);
  const columns = await db.prepare("PRAGMA table_info(portfolio_versions)").all<{ name: string }>();
  if (!(columns.results ?? []).some((column) => column.name === "source_name")) {
    await db.prepare(
      "ALTER TABLE portfolio_versions ADD COLUMN source_name TEXT NOT NULL DEFAULT 'Saved portfolio'",
    ).run();
  }
}

function serialize(row: PortfolioRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    sourceName: row.source_name,
    isDefault: row.is_default === 1,
    positions: JSON.parse(row.positions_json) as Position[],
  };
}

async function listVersions(db: D1Database) {
  const response = await db.prepare(`
    SELECT id, created_at, archived_at, positions_json, source_name, is_default
    FROM portfolio_versions
    ORDER BY is_default DESC, COALESCE(archived_at, created_at) DESC
    LIMIT 50
  `).all<PortfolioRow>();
  return (response.results ?? []).map(serialize);
}

export async function GET() {
  const db = await database();
  await ensureSchema(db);
  return NextResponse.json({ versions: await listVersions(db) });
}

export async function POST(request: Request) {
  const payload = await request.json() as {
    previousPositions?: Position[];
    positions?: Position[];
    sourceName?: string;
  };
  if (!Array.isArray(payload.positions) || !payload.positions.length) {
    return NextResponse.json({ error: "A non-empty portfolio is required." }, { status: 400 });
  }
  const db = await database();
  await ensureSchema(db);
  const now = new Date().toISOString();
  const current = await db.prepare(`
    SELECT id, created_at, archived_at, positions_json, source_name, is_default
    FROM portfolio_versions WHERE is_default = 1 LIMIT 1
  `).all<PortfolioRow>();
  const statements: D1Statement[] = [];
  const currentRow = current.results?.[0];
  if (currentRow) {
    statements.push(
      db.prepare("UPDATE portfolio_versions SET is_default = 0, archived_at = ? WHERE id = ?")
        .bind(now, currentRow.id),
    );
  } else if (Array.isArray(payload.previousPositions) && payload.previousPositions.length) {
    statements.push(
      db.prepare(`
        INSERT INTO portfolio_versions
          (id, created_at, archived_at, positions_json, source_name, is_default)
        VALUES (?, ?, ?, ?, ?, 0)
      `).bind(crypto.randomUUID(), now, now, JSON.stringify(payload.previousPositions), "Built-in default"),
    );
  }
  statements.push(
    db.prepare(`
      INSERT INTO portfolio_versions
        (id, created_at, archived_at, positions_json, source_name, is_default)
      VALUES (?, ?, NULL, ?, ?, 1)
    `).bind(
      crypto.randomUUID(),
      now,
      JSON.stringify(payload.positions),
      payload.sourceName?.trim() || "Saved portfolio",
    ),
  );
  await db.batch(statements);
  return NextResponse.json({ versions: await listVersions(db) });
}

export async function PUT(request: Request) {
  const payload = await request.json() as { positions?: Position[] };
  if (!Array.isArray(payload.positions) || !payload.positions.length) {
    return NextResponse.json({ error: "A non-empty portfolio is required." }, { status: 400 });
  }
  const db = await database();
  await ensureSchema(db);
  const current = await db.prepare(
    "SELECT id FROM portfolio_versions WHERE is_default = 1 LIMIT 1",
  ).all<{ id: string }>();
  const currentId = current.results?.[0]?.id;
  if (!currentId) {
    return NextResponse.json({ error: "No current default portfolio was found." }, { status: 404 });
  }
  await db.prepare(
    "UPDATE portfolio_versions SET positions_json = ? WHERE id = ?",
  ).bind(JSON.stringify(payload.positions), currentId).run();
  return NextResponse.json({ versions: await listVersions(db) });
}
