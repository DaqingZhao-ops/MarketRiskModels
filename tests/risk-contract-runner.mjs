import fs from "node:fs";

import { calculateRisk } from "../lib/risk.ts";

const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const results = Object.fromEntries(
  ["parametric", "historical", "monteCarlo"].map((model) => [
    model,
    calculateRisk(
      fixture.positions,
      model,
      fixture.confidence,
      fixture.horizon,
      fixture.history,
    ),
  ]),
);

process.stdout.write(JSON.stringify(results));
