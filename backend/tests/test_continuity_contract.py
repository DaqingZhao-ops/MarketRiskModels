import json
import subprocess
from pathlib import Path

import pytest

from market_risk.engine import calculate_risk
from market_risk.schemas import RiskRequest


ROOT = Path(__file__).parents[2]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "risk-contract.json"
RUNNER_PATH = ROOT / "tests" / "risk-contract-runner.mjs"


@pytest.fixture(scope="module")
def contract_results() -> tuple[dict, dict]:
    fixture = json.loads(FIXTURE_PATH.read_text())
    completed = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            str(RUNNER_PATH),
            str(FIXTURE_PATH),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    continuity = json.loads(completed.stdout)
    prices = {
        series["symbol"]: dict(zip(series["dates"], series["adjustedClose"], strict=True))
        for series in fixture["history"]["series"]
    }
    python = {}
    for model in ("parametric", "historical", "monteCarlo"):
        request = RiskRequest(
            positions=fixture["positions"],
            model=model,
            confidence=fixture["confidence"],
            horizon=fixture["horizon"],
        )
        python[model] = calculate_risk(request, prices).model_dump(
            mode="json",
            by_alias=True,
        )
    return python, continuity


@pytest.mark.parametrize("model", ["parametric", "historical"])
def test_deterministic_risk_results_match_continuity_engine(
    contract_results: tuple[dict, dict],
    model: str,
) -> None:
    python, continuity = contract_results
    exact_fields = [
        "marketValue",
        "observations",
        "historyStart",
        "historyEnd",
    ]
    numeric_fields = [
        "var",
        "expectedShortfall",
        "dailyVolatility",
        "diversificationBenefit",
        "range",
        "varMarker",
    ]

    for field in exact_fields:
        assert python[model][field] == continuity[model].get(field)
    for field in numeric_fields:
        assert python[model][field] == pytest.approx(
            continuity[model][field],
            rel=1e-8,
            abs=1e-9,
        )
    assert [item["id"] for item in python[model]["contributions"]] == [
        item["id"] for item in continuity[model]["contributions"]
    ]
    assert [item["share"] for item in python[model]["contributions"]] == pytest.approx(
        [item["share"] for item in continuity[model]["contributions"]],
        rel=1e-12,
    )


def test_monte_carlo_results_remain_statistically_comparable(
    contract_results: tuple[dict, dict],
) -> None:
    python, continuity = contract_results
    python_result = python["monteCarlo"]
    continuity_result = continuity["monteCarlo"]

    assert python_result["marketValue"] == continuity_result["marketValue"]
    assert python_result["observations"] == continuity_result["observations"] == 10_000
    assert python_result["dailyVolatility"] == pytest.approx(
        continuity_result["dailyVolatility"],
        rel=1e-9,
    )
    assert python_result["var"] == pytest.approx(continuity_result["var"], rel=0.05)
    assert python_result["expectedShortfall"] == pytest.approx(
        continuity_result["expectedShortfall"],
        rel=0.05,
    )
