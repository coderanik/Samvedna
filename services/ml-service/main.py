"""
Samvedna ML Service — distress scoring via Google Gemini + structured triage fields.

Explainability: LLM rationale + signal tags (NOT SHAP/LIME).
Escalation fields from the model are advisory; API also applies transparent MVP rules.
"""

from __future__ import annotations

import json
import os
import re
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Import new modules
from forecast import forecast_trajectory
from prosody import analyse_voice

load_dotenv()
load_dotenv("../../.env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY not configured")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


app = FastAPI(title="Samvedna ML Service", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RiskLevel = Literal["low", "moderate", "high", "critical"]
TrendDirection = Literal["rising", "stable", "improving"]
Confidence = Literal["high", "medium", "low", "fallback"]


class HistoryItem(BaseModel):
    transcript: str
    score: int
    risk_level: RiskLevel
    created_at: str


class CaseMetadata(BaseModel):
    case_type: str
    days_since_opened: int
    preferred_language: str = "en"
    case_status: Optional[str] = None
    channel: Optional[str] = None


class ScoreRequest(BaseModel):
    transcript: str
    recent_history: list[HistoryItem] = Field(default_factory=list)
    case_metadata: CaseMetadata


class InterventionRec(BaseModel):
    type: str
    description: str


class ScoreResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    signals_detected: list[str]
    reasoning: str
    sentiment: Optional[str] = None
    emotion_indicators: list[str] = Field(default_factory=list)
    trend_direction: Optional[TrendDirection] = None
    escalation_risk_7d: Optional[int] = Field(default=None, ge=0, le=100)
    escalation_reasoning: Optional[str] = None
    recommended_interventions: list[InterventionRec] = Field(default_factory=list)
    contributing_factors: list[str] = Field(default_factory=list)
    model_confidence: Confidence = "medium"
    prediction_method: str = "mvp_rules_plus_llm"
    disclaimer: str = (
        "Triage screening only — not a clinical diagnosis. "
        "Escalation risk is an MVP decision-support estimate, not a validated forecast."
    )


class ExplainRequest(BaseModel):
    score: int
    risk_level: RiskLevel
    signals_detected: list[str]
    reasoning: str
    trend_direction: Optional[str] = None
    escalation_risk_7d: Optional[int] = None
    contributing_factors: list[str] = Field(default_factory=list)


SCORING_SYSTEM_PROMPT = """You are a compassionate TRIAGE assistant for SAMVEDNA — Dynamic Mental Health Monitoring for victims/witnesses under investigation, trial, compensation, and rehabilitation (NHAA / PoA context).

HARD RULES:
- This is TRIAGE/SCREENING for authorised professionals — NOT a clinical diagnosis or medical order.
- Never invent facts not supported by the transcript or history.
- Weight TREND: worsening last 3 check-ins should raise score and escalation_risk_7d.
- Be culturally sensitive (Hinglish/Tanglish, stigma, court delays, intimidation, compensation delays).
- For voice/IVRS channels, infer distress from language only (no acoustic stress model available).

Return ONLY valid JSON:
{
  "score": <0-100 integer>,
  "risk_level": "low"|"moderate"|"high"|"critical",
  "signals_detected": ["snake_case_tags"],
  "sentiment": "negative"|"mixed"|"neutral"|"positive",
  "emotion_indicators": ["fear","anxiety","hopelessness",...],
  "trend_direction": "rising"|"stable"|"improving",
  "escalation_risk_7d": <0-100 integer advisory probability-like band>,
  "escalation_reasoning": "<1-2 sentences>",
  "contributing_factors": ["short_snake_case_factors"],
  "recommended_interventions": [
    {"type":"counselling|medical|legal|financial|protection|witness_protection|relocation|rehabilitation|follow_up","description":"..."}
  ],
  "reasoning": "<2-3 sentences WHY this score, for counsellor Reason Card>",
  "model_confidence": "high"|"medium"|"low"
}

Risk mapping: low 0-30, moderate 31-55, high 56-75, critical 76-100.
Interventions are RECOMMENDATIONS for humans — not automated orders.
"""


def _gemini_text(system: Optional[str], user: str, json_mode: bool = False) -> str:
    config_kwargs: dict = {"max_output_tokens": 1536}
    if system:
        config_kwargs["system_instruction"] = system
    if json_mode:
        config_kwargs["response_mime_type"] = "application/json"

    response = _get_client().models.generate_content(
        model=GEMINI_MODEL,
        contents=user,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    return response.text or ""


def _build_user_prompt(req: ScoreRequest) -> str:
    history_text = ""
    if req.recent_history:
        history_text = "\n\nRecent check-in history (newest first):\n"
        for i, h in enumerate(req.recent_history[:5], 1):
            history_text += f'  {i}. [{h.risk_level}, score={h.score}] "{h.transcript[:200]}"\n'

    trend_note = ""
    if len(req.recent_history) >= 3:
        recent_scores = [h.score for h in req.recent_history[:3]]
        if recent_scores[0] > recent_scores[1] > recent_scores[2]:
            trend_note = "\n⚠ TREND: Scores worsening over last 3 check-ins — weight heavily."

    return f"""Case context:
- Case type: {req.case_metadata.case_type}
- Case stage: {req.case_metadata.case_status or "unknown"}
- Channel: {req.case_metadata.channel or "chat"}
- Days since case opened: {req.case_metadata.days_since_opened}
- Victim preferred language: {req.case_metadata.preferred_language}
{history_text}{trend_note}

Current check-in transcript:
\"\"\"{req.transcript}\"\"\"

Analyze and return JSON only."""


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _risk_from_score(score: int) -> RiskLevel:
    if score <= 30:
        return "low"
    if score <= 55:
        return "moderate"
    if score <= 75:
        return "high"
    return "critical"


def _fallback_score(req: ScoreRequest) -> ScoreResponse:
    text = req.transcript.lower()
    signals: list[str] = []
    emotions: list[str] = []
    score = 25

    keywords = {
        "fear": ("darr", "afraid", "scared", "bhay", "பயம்"),
        "sleep_disturbance": ("sleep", "neend", "insomnia"),
        "hopelessness": ("hopeless", "kuch nahi", "nothing will"),
        "safety_concern": ("threat", "danger", "safe", "intimidation"),
        "financial_stress": ("money", "paise", "compensation"),
        "isolation": ("alone", "withdraw", "தனிமை"),
        "legal_stress": ("court", "hearing", "trial", "police"),
    }

    for signal, words in keywords.items():
        if any(w in text for w in words):
            signals.append(signal)
            emotions.append(signal.split("_")[0])
            score += 12

    if req.recent_history:
        avg = sum(h.score for h in req.recent_history[:3]) / min(3, len(req.recent_history))
        score = int(score * 0.6 + avg * 0.4)

    score = min(100, max(0, score))
    risk = _risk_from_score(score)

    trend: TrendDirection = "stable"
    if len(req.recent_history) >= 2:
        delta = score - req.recent_history[0].score
        if delta >= 8:
            trend = "rising"
        elif delta <= -8:
            trend = "improving"

    esc = min(100, score + (18 if trend == "rising" else 0) + (10 if risk in ("high", "critical") else 0))

    interventions: list[InterventionRec] = []
    if risk in ("high", "critical") or esc >= 60:
        interventions.append(
            InterventionRec(
                type="counselling",
                description="Priority counsellor contact recommended for human triage.",
            )
        )
        interventions.append(
            InterventionRec(type="follow_up", description="Follow-up within 24–48 hours.")
        )
    if "safety_concern" in signals:
        interventions.append(
            InterventionRec(
                type="witness_protection",
                description="Review protection / safety plan with authorised officials.",
            )
        )

    return ScoreResponse(
        score=score,
        risk_level=risk,
        signals_detected=signals or ["general_distress"],
        reasoning=(
            f"Fallback rule-based triage ({score}/100, {risk}). "
            f"Signals: {', '.join(signals) or 'none specific'}. "
            "Configure GEMINI_API_KEY for LLM-powered scoring."
        ),
        sentiment="negative" if score >= 50 else "mixed",
        emotion_indicators=emotions[:5],
        trend_direction=trend,
        escalation_risk_7d=esc,
        escalation_reasoning="MVP rules estimate from current score, trend, and threat-like signals.",
        recommended_interventions=interventions,
        contributing_factors=signals[:5],
        model_confidence="fallback",
        prediction_method="rules_only",
    )


def _normalize_score(parsed: dict) -> ScoreResponse:
    score = min(100, max(0, int(parsed.get("score", 0))))
    risk = parsed.get("risk_level") or _risk_from_score(score)
    if risk not in ("low", "moderate", "high", "critical"):
        risk = _risk_from_score(score)

    interventions_raw = parsed.get("recommended_interventions") or []
    interventions: list[InterventionRec] = []
    for item in interventions_raw:
        if isinstance(item, dict) and item.get("type") and item.get("description"):
            interventions.append(
                InterventionRec(type=str(item["type"]), description=str(item["description"]))
            )

    esc = parsed.get("escalation_risk_7d")
    if esc is not None:
        esc = min(100, max(0, int(esc)))

    trend = parsed.get("trend_direction")
    if trend not in ("rising", "stable", "improving"):
        trend = None

    conf = parsed.get("model_confidence") or "medium"
    if conf not in ("high", "medium", "low", "fallback"):
        conf = "medium"

    return ScoreResponse(
        score=score,
        risk_level=risk,  # type: ignore[arg-type]
        signals_detected=list(parsed.get("signals_detected") or []),
        reasoning=parsed.get("reasoning")
        or "Score computed from transcript analysis for triage screening.",
        sentiment=parsed.get("sentiment"),
        emotion_indicators=list(parsed.get("emotion_indicators") or []),
        trend_direction=trend,  # type: ignore[arg-type]
        escalation_risk_7d=esc,
        escalation_reasoning=parsed.get("escalation_reasoning"),
        recommended_interventions=interventions,
        contributing_factors=list(parsed.get("contributing_factors") or []),
        model_confidence=conf,  # type: ignore[arg-type]
        prediction_method="mvp_rules_plus_llm",
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ml-service",
        "provider": "gemini",
        "model": GEMINI_MODEL,
        "gemini_configured": bool(GEMINI_API_KEY),
        "version": "0.3.0",
    }


@app.post("/score", response_model=ScoreResponse)
async def score_checkin(req: ScoreRequest):
    if not GEMINI_API_KEY:
        return _fallback_score(req)

    try:
        raw = _gemini_text(
            SCORING_SYSTEM_PROMPT,
            _build_user_prompt(req),
            json_mode=True,
        )
        return _normalize_score(_parse_json_response(raw))
    except Exception as e:
        print(f"[Score error] {e}")
        fb = _fallback_score(req)
        fb.reasoning = (
            f"Gemini unavailable — using rule-based fallback. ({e.__class__.__name__}) "
            + fb.reasoning
        )
        return fb


@app.post("/explain")
async def explain_score(req: ExplainRequest):
    why = [
        f"Distress score: {req.score}/100 ({req.risk_level})",
    ]
    if req.trend_direction:
        why.append(f"Trend: {req.trend_direction}")
    if req.escalation_risk_7d is not None:
        why.append(f"Escalation risk (7d MVP): {req.escalation_risk_7d}/100")
    if req.signals_detected:
        why.append("Signals: " + ", ".join(req.signals_detected[:8]))
    if req.contributing_factors:
        why.append("Factors: " + ", ".join(req.contributing_factors[:8]))

    action = "Continue routine monitoring."
    if req.risk_level == "critical" or (req.escalation_risk_7d or 0) >= 75:
        action = "Immediate counsellor intervention recommended (human decision)."
    elif req.risk_level == "high" or (req.escalation_risk_7d or 0) >= 55:
        action = "Priority counselling and 24–48h follow-up recommended."

    return {
        "title": "Why was this flagged?",
        "bullets": why,
        "reasoning": req.reasoning,
        "recommended_action": action,
        "disclaimer": (
            "LLM/rule triage rationale for authorised professionals — "
            "not a clinical diagnosis or formal feature attribution (SHAP)."
        ),
    }


class ChatRequest(BaseModel):
    message: str
    preferred_language: str = "en"
    conversation_history: list[dict] = Field(default_factory=list)


@app.post("/score-voice")
async def score_voice(
    file: UploadFile = File(...),
    baseline: Optional[str] = Form(None),
):
    """
    Score vocal stress from audio file.
    
    Accepts multipart/form-data with:
    - file: audio file (webm, wav, mp3, etc)
    - baseline: optional JSON string with personal baseline features
    
    Returns prosody features + Vocal Stress Index (0-100).
    """
    try:
        audio_bytes = await file.read()
        baseline_dict = json.loads(baseline) if baseline else None

        # Infer sample rate from filename if possible (default 16kHz)
        sample_rate = 16000

        result = analyse_voice(
            audio_bytes=audio_bytes,
            sample_rate=sample_rate,
            baseline=baseline_dict,
        )

        return result
    except Exception as e:
        return {
            "error": str(e),
            "vocal_stress_index": None,
            "confidence": "error",
            "extractor": "none",
        }


class ForecastRequest(BaseModel):
    scores: list[dict] = Field(
        ..., description="List of {score, created_at} dicts, oldest first"
    )
    horizon_days: int = Field(default=7, ge=1, le=30)
    features: Optional[dict] = Field(
        default=None, description="Optional features like engagement_drop, vocal_stress_index"
    )


@app.post("/forecast")
async def forecast_distress(req: ForecastRequest):
    """
    Forecast distress trajectory over next N days with crisis probability.
    
    Uses Holt exponential smoothing when ≥4 points and statsmodels available,
    falls back to linear+EWMA or rule-based for fewer points.
    """
    try:
        result = forecast_trajectory(
            scores=req.scores,
            horizon_days=req.horizon_days,
            features=req.features,
        )
        return result
    except Exception as e:
        return {
            "error": str(e),
            "predicted_score": None,
            "crisis_probability": None,
            "method": "error",
        }


@app.post("/chat")
async def chat_response(req: ChatRequest):
    lang_map = {"en": "English", "hi": "Hindi", "ta": "Tamil"}
    lang_name = lang_map.get(req.preferred_language, "English")

    if not GEMINI_API_KEY:
        return {
            "response": "Thank you for sharing. I'm here to listen whenever you're ready. (Configure GEMINI_API_KEY for full responses.)",
        }

    system = f"""You are Mann-Mitra, a warm companion for atrocity survivors and complainants in India.
Respond in {lang_name}. If the user writes in code-mixed language (Hinglish/Tanglish), match their style naturally.
Ask ONE gentle question at a time. Never interrogate. Never diagnose. Be empathetic and culturally sensitive.
Keep responses under 3 sentences. This is a support check-in, not an emergency service.
If the person seems in immediate danger, gently encourage contacting 112 or KIRAN 1800-599-0019 / Tele-MANAS 14416 / NHAA 14566."""

    try:
        history = []
        for turn in req.conversation_history[-6:]:
            role = "model" if turn.get("role") == "assistant" else "user"
            content = turn.get("content", "").strip()
            if content:
                history.append(
                    types.Content(role=role, parts=[types.Part(text=content)])
                )

        if history:
            chat = _get_client().chats.create(
                model=GEMINI_MODEL,
                config=types.GenerateContentConfig(system_instruction=system),
                history=history,
            )
            response = chat.send_message(req.message)
        else:
            response = _get_client().models.generate_content(
                model=GEMINI_MODEL,
                contents=req.message,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=512,
                ),
            )
        return {"response": response.text or "I'm here with you."}
    except Exception as e:
        print(f"[Chat error] {e}")
        return {
            "response": (
                "Thank you for sharing that with me. Could you tell me a bit more about "
                "how your sleep and mood have been lately?"
            ),
        }
