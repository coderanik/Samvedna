"""
Trajectory forecasting and crisis probability estimation for distress scores.

Uses Holt's exponential smoothing when statsmodels available, falls back to linear + EWMA.
Requires prospective validation on real NHAA data before deployment.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Literal, Optional

import numpy as np

# Soft import — use Holt if available, else simple fallback
try:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False

Method = Literal["holt", "linear_ewma", "rule_based"]


def _parse_iso_date(date_str: str) -> datetime:
    """Parse ISO date string to datetime."""
    # Handle both with and without timezone
    if "T" in date_str:
        if "Z" in date_str:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        elif "+" in date_str or date_str.count("-") > 2:
            return datetime.fromisoformat(date_str)
        else:
            return datetime.fromisoformat(date_str)
    else:
        return datetime.fromisoformat(date_str)


def _crisis_probability_simple(
    current_score: float,
    slope: float,
    volatility: float,
    days_ahead: int = 7,
) -> float:
    """
    Simple crisis probability estimator (logistic model proxy).
    
    Crisis defined as score ≥ 76. Inputs:
    - current_score: latest score
    - slope: 3-point trend (points/day)
    - volatility: std dev of recent scores
    - days_ahead: forecast horizon
    
    Returns probability 0-1.
    """
    # Projected score at horizon (linear extrapolation)
    projected = current_score + slope * days_ahead

    # Distance to crisis threshold
    crisis_threshold = 76.0
    distance = crisis_threshold - projected

    # Logistic function: P(crisis) high when projected near/above threshold
    # and when volatility is high (uncertainty increases risk)
    z = -distance / (volatility + 5.0)  # normalize by volatility
    prob = 1.0 / (1.0 + math.exp(-z))

    # Boost probability if current score already elevated
    if current_score >= 70:
        prob = min(1.0, prob * 1.3)
    elif current_score >= 60:
        prob = min(1.0, prob * 1.15)

    return max(0.0, min(1.0, prob))


def _forecast_holt(
    scores: list[float],
    dates: list[datetime],
    horizon_days: int = 7,
    alpha: float = 0.3,
    beta: float = 0.1,
) -> dict:
    """
    Holt's linear exponential smoothing using statsmodels.
    
    Returns trajectory with prediction intervals.
    """
    # Fit Holt model
    model = ExponentialSmoothing(
        scores,
        trend="add",
        seasonal=None,
        damped_trend=False,
    )
    fitted = model.fit(smoothing_level=alpha, smoothing_trend=beta, optimized=False)

    # Forecast
    forecast_steps = horizon_days
    forecast_result = fitted.forecast(steps=forecast_steps)
    
    # Handle both numpy array and pandas Series
    if hasattr(forecast_result, 'iloc'):
        predicted_score = float(forecast_result.iloc[-1])
    else:
        predicted_score = float(forecast_result[-1])

    # Prediction intervals (approximate via residual std)
    residuals = fitted.fittedvalues - np.array(scores)
    residual_std = float(np.std(residuals))

    # 95% PI: ±1.96 * std * sqrt(steps) for random walk component
    interval_width = 1.96 * residual_std * math.sqrt(horizon_days)
    ci_lower = max(0.0, predicted_score - interval_width)
    ci_upper = min(100.0, predicted_score + interval_width)

    # Build trajectory
    trajectory = []
    last_date = dates[-1]
    for day in range(1, horizon_days + 1):
        if hasattr(forecast_result, 'iloc'):
            day_score = float(forecast_result.iloc[day - 1])
        else:
            day_score = float(forecast_result[day - 1])
        day_interval = 1.96 * residual_std * math.sqrt(day)
        trajectory.append(
            {
                "day": day,
                "score": round(day_score, 1),
                "lower": round(max(0.0, day_score - day_interval), 1),
                "upper": round(min(100.0, day_score + day_interval), 1),
            }
        )

    # Backtest MAE (in-sample, rough estimate)
    fitted_values = fitted.fittedvalues
    backtest_mae = float(np.mean(np.abs(fitted_values - np.array(scores))))

    return {
        "predicted_score": round(predicted_score, 1),
        "ci_lower": round(ci_lower, 1),
        "ci_upper": round(ci_upper, 1),
        "trajectory": trajectory,
        "backtest_mae": round(backtest_mae, 1),
        "method": "holt",
    }


def _forecast_linear_ewma(
    scores: list[float],
    dates: list[datetime],
    horizon_days: int = 7,
) -> dict:
    """
    Fallback: simple linear regression + EWMA for trend, with conservative intervals.
    """
    n = len(scores)
    x = np.arange(n, dtype=float)
    y = np.array(scores, dtype=float)

    # Linear regression (least squares)
    x_mean = np.mean(x)
    y_mean = np.mean(y)
    numerator = np.sum((x - x_mean) * (y - y_mean))
    denominator = np.sum((x - x_mean) ** 2)
    slope = numerator / denominator if denominator > 1e-9 else 0.0
    intercept = y_mean - slope * x_mean

    # EWMA for adaptive trend (alpha=0.3)
    ewma = [scores[0]]
    alpha = 0.3
    for s in scores[1:]:
        ewma.append(alpha * s + (1 - alpha) * ewma[-1])

    # Blend linear + EWMA
    last_ewma = ewma[-1]
    last_linear = slope * (n - 1) + intercept
    blended_level = 0.6 * last_ewma + 0.4 * last_linear

    # Project forward
    predicted_score = blended_level + slope * horizon_days

    # Conservative intervals from residual std
    residuals = y - (slope * x + intercept)
    residual_std = float(np.std(residuals))
    interval_width = 2.0 * residual_std * math.sqrt(horizon_days)

    ci_lower = max(0.0, predicted_score - interval_width)
    ci_upper = min(100.0, predicted_score + interval_width)

    # Build trajectory
    trajectory = []
    for day in range(1, horizon_days + 1):
        day_score = blended_level + slope * day
        day_interval = 2.0 * residual_std * math.sqrt(day)
        trajectory.append(
            {
                "day": day,
                "score": round(day_score, 1),
                "lower": round(max(0.0, day_score - day_interval), 1),
                "upper": round(min(100.0, day_score + day_interval), 1),
            }
        )

    # Backtest MAE
    fitted = slope * x + intercept
    backtest_mae = float(np.mean(np.abs(fitted - y)))

    return {
        "predicted_score": round(predicted_score, 1),
        "ci_lower": round(ci_lower, 1),
        "ci_upper": round(ci_upper, 1),
        "trajectory": trajectory,
        "backtest_mae": round(backtest_mae, 1),
        "method": "linear_ewma",
    }


def _forecast_rule_based(
    scores: list[float],
    dates: list[datetime],
    horizon_days: int = 7,
) -> dict:
    """
    Rule-based fallback when <4 points: use last 2-3 for slope.
    """
    n = len(scores)
    if n == 0:
        return {
            "predicted_score": 50.0,
            "ci_lower": 0.0,
            "ci_upper": 100.0,
            "trajectory": [],
            "backtest_mae": None,
            "method": "rule_based",
        }

    # Use last score as baseline
    last_score = scores[-1]

    # Estimate slope from last 2-3 points
    if n >= 3:
        slope = (scores[-1] - scores[-3]) / 2.0  # avg change per check-in
    elif n == 2:
        slope = scores[-1] - scores[-2]
    else:
        slope = 0.0

    # Assume check-ins are ~every 2 days (rough), so slope is per 2-day
    # Convert to per-day slope
    slope_per_day = slope / 2.0

    predicted_score = last_score + slope_per_day * horizon_days
    predicted_score = max(0.0, min(100.0, predicted_score))

    # Conservative wide intervals
    ci_lower = max(0.0, predicted_score - 25.0)
    ci_upper = min(100.0, predicted_score + 25.0)

    # Build trajectory
    trajectory = []
    for day in range(1, horizon_days + 1):
        day_score = last_score + slope_per_day * day
        day_score = max(0.0, min(100.0, day_score))
        trajectory.append(
            {
                "day": day,
                "score": round(day_score, 1),
                "lower": round(max(0.0, day_score - 25.0), 1),
                "upper": round(min(100.0, day_score + 25.0), 1),
            }
        )

    return {
        "predicted_score": round(predicted_score, 1),
        "ci_lower": round(ci_lower, 1),
        "ci_upper": round(ci_upper, 1),
        "trajectory": trajectory,
        "backtest_mae": None,
        "method": "rule_based",
    }


def forecast_trajectory(
    scores: list[dict],
    horizon_days: int = 7,
    features: Optional[dict] = None,
) -> dict:
    """
    Forecast distress score trajectory over the next `horizon_days`.

    Args:
        scores: List of {score: float, created_at: str} dicts, oldest first
        horizon_days: Forecast horizon in days
        features: Optional dict of additional features (e.g. engagement, vocal stress)

    Returns:
        {
            predicted_score: float (0-100),
            ci_lower: float,
            ci_upper: float,
            crisis_probability: float (0-1),
            method: "holt"|"linear_ewma"|"rule_based",
            trajectory: [{day, score, lower, upper}, ...],
            backtest_mae: float | None,
            model_version: str,
            disclaimer: str
        }
    """
    if not scores:
        return {
            "predicted_score": 50.0,
            "ci_lower": 0.0,
            "ci_upper": 100.0,
            "crisis_probability": 0.5,
            "method": "rule_based",
            "trajectory": [],
            "backtest_mae": None,
            "model_version": "0.1.0",
            "disclaimer": (
                "No check-in history available. "
                "Trained on synthetic data — requires prospective NHAA validation."
            ),
        }

    # Parse scores
    score_values = [float(s["score"]) for s in scores]
    try:
        dates = [_parse_iso_date(s["created_at"]) for s in scores]
    except Exception:
        # If date parsing fails, use sequential indices
        dates = [datetime.now() - timedelta(days=len(scores) - i) for i in range(len(scores))]

    n = len(score_values)

    # Choose method based on data availability
    if n >= 4 and HAS_STATSMODELS:
        result = _forecast_holt(score_values, dates, horizon_days)
    elif n >= 4:
        result = _forecast_linear_ewma(score_values, dates, horizon_days)
    else:
        result = _forecast_rule_based(score_values, dates, horizon_days)

    # Crisis probability
    current_score = score_values[-1]

    # Compute slope (last 3 points if available)
    if n >= 3:
        # Approximate days between points
        if len(dates) >= 3:
            days_span = (dates[-1] - dates[-3]).days
            days_span = max(1, days_span)  # avoid divide by zero
        else:
            days_span = 4  # assume ~2 days per check-in
        slope = (score_values[-1] - score_values[-3]) / days_span
    elif n == 2:
        if len(dates) >= 2:
            days_span = max(1, (dates[-1] - dates[-2]).days)
        else:
            days_span = 2
        slope = (score_values[-1] - score_values[-2]) / days_span
    else:
        slope = 0.0

    volatility = float(np.std(score_values[-5:])) if n >= 2 else 15.0

    crisis_prob = _crisis_probability_simple(
        current_score, slope, volatility, horizon_days
    )

    # Adjust crisis probability based on features if provided
    if features:
        # Example: boost crisis prob if engagement dropped or vocal stress high
        engagement_drop = features.get("engagement_drop", False)
        vocal_stress_high = features.get("vocal_stress_index", 0) > 70

        if engagement_drop:
            crisis_prob = min(1.0, crisis_prob * 1.2)
        if vocal_stress_high:
            crisis_prob = min(1.0, crisis_prob * 1.15)

    result["crisis_probability"] = round(crisis_prob, 3)
    result["model_version"] = "0.1.0"
    result["disclaimer"] = (
        "Trained on synthetic longitudinal data calibrated to published trauma-recovery "
        "trajectories. Requires prospective validation on real NHAA data before deployment."
    )

    return result
