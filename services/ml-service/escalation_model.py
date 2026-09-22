"""
Sklearn escalation risk model trained on synthetic longitudinal features.

LIVE for demo with honesty disclaimer — not prospectively validated on NHAA outcomes.
"""

from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler

    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

FEATURE_NAMES = [
    "latest_score",
    "slope_3",
    "volatility",
    "missed_outreach",
    "days_since_contact",
    "bail_flag",
    "threat_signals",
    "vocal_stress",
    "engagement_drop",
    "high_risk_streak",
]

_MODEL: Optional[Any] = None
_SCALER: Optional[Any] = None
MODEL_VERSION = "sklearn_logit_synth_v1"
HONESTY = (
    "Logistic escalation model trained on synthetic longitudinal trajectories "
    "(trauma-recovery calibrated). Not prospectively validated on real NHAA outcomes."
)


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _train_synthetic() -> tuple[Any, Any]:
    """Generate synthetic crisis labels and fit logistic regression."""
    rng = np.random.default_rng(42)
    n = 4000
    X = np.zeros((n, len(FEATURE_NAMES)))
    # latest_score
    X[:, 0] = rng.uniform(5, 95, n)
    # slope
    X[:, 1] = rng.normal(0, 8, n)
    # volatility
    X[:, 2] = rng.uniform(2, 30, n)
    # missed outreach
    X[:, 3] = rng.integers(0, 6, n)
    # days since contact
    X[:, 4] = rng.integers(0, 21, n)
    # bail
    X[:, 5] = rng.integers(0, 2, n)
    # threat
    X[:, 6] = rng.integers(0, 4, n)
    # vocal stress
    X[:, 7] = rng.uniform(10, 90, n)
    # engagement drop
    X[:, 8] = rng.integers(0, 2, n)
    # high risk streak
    X[:, 9] = rng.integers(0, 5, n)

    # Latent crisis propensity
    logit = (
        -4.2
        + 0.055 * X[:, 0]
        + 0.09 * X[:, 1]
        + 0.04 * X[:, 2]
        + 0.35 * X[:, 3]
        + 0.08 * X[:, 4]
        + 0.7 * X[:, 5]
        + 0.45 * X[:, 6]
        + 0.02 * X[:, 7]
        + 0.55 * X[:, 8]
        + 0.4 * X[:, 9]
    )
    prob = 1 / (1 + np.exp(-logit))
    y = (rng.random(n) < prob).astype(int)

    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    model = LogisticRegression(max_iter=400, class_weight="balanced")
    model.fit(Xs, y)
    return model, scaler


def _ensure_model() -> bool:
    global _MODEL, _SCALER
    if not HAS_SKLEARN:
        return False
    if _MODEL is None:
        _MODEL, _SCALER = _train_synthetic()
    return True


def features_from_dict(feats: dict) -> np.ndarray:
    return np.array(
        [
            [
                float(feats.get("latest_score", 50)),
                float(feats.get("slope_3", 0)),
                float(feats.get("volatility", 10)),
                float(feats.get("missed_outreach", 0)),
                float(feats.get("days_since_contact", 0)),
                float(feats.get("bail_flag", 0)),
                float(feats.get("threat_signals", 0)),
                float(feats.get("vocal_stress", 40)),
                float(feats.get("engagement_drop", 0)),
                float(feats.get("high_risk_streak", 0)),
            ]
        ],
        dtype=float,
    )


def predict_escalation(feats: dict) -> dict:
    """
    Returns crisis/escalation probability for next ~7 days.
    """
    if not _ensure_model():
        # Pure logistic fallback without sklearn
        latest = float(feats.get("latest_score", 50))
        slope = float(feats.get("slope_3", 0))
        missed = float(feats.get("missed_outreach", 0))
        days = float(feats.get("days_since_contact", 0))
        bail = float(feats.get("bail_flag", 0))
        threat = float(feats.get("threat_signals", 0))
        vocal = float(feats.get("vocal_stress", 40))
        z = (
            -3.5
            + 0.05 * latest
            + 0.08 * slope
            + 0.3 * missed
            + 0.07 * days
            + 0.6 * bail
            + 0.4 * threat
            + 0.015 * vocal
        )
        p = _sigmoid(z)
        return {
            "escalation_probability": round(p, 4),
            "risk_7d": int(round(p * 100)),
            "method": "logit_fallback",
            "model_version": "fallback_v1",
            "honesty_note": HONESTY,
            "sklearn": False,
            "feature_names": FEATURE_NAMES,
        }

    x = features_from_dict(feats)
    xs = _SCALER.transform(x)
    p = float(_MODEL.predict_proba(xs)[0][1])
    coef = {
        name: round(float(c), 4)
        for name, c in zip(FEATURE_NAMES, _MODEL.coef_[0])
    }
    return {
        "escalation_probability": round(p, 4),
        "risk_7d": int(round(p * 100)),
        "method": "sklearn_logistic",
        "model_version": MODEL_VERSION,
        "honesty_note": HONESTY,
        "sklearn": True,
        "coefficients": coef,
        "feature_names": FEATURE_NAMES,
    }
