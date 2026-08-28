"""
Samvedna ML Service — distress scoring via Google Gemini.

The reasoning output IS the explainability layer for MVP.
This is LLM-generated rationale, NOT formal feature-attribution (SHAP/LIME).

Future: swap translation to Bhashini/IndicTrans2 for offline Indic language support.
"""

import json
import os
import re
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

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


app = FastAPI(title="Samvedna ML Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RiskLevel = Literal["low", "moderate", "high", "critical"]


class HistoryItem(BaseModel):
    transcript: str
    score: int
    risk_level: RiskLevel
    created_at: str


class CaseMetadata(BaseModel):
    case_type: str
    days_since_opened: int
    preferred_language: str = "en"


class ScoreRequest(BaseModel):
    transcript: str
    recent_history: list[HistoryItem] = Field(default_factory=list)
    case_metadata: CaseMetadata


class ScoreResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    risk_level: RiskLevel
    signals_detected: list[str]
    reasoning: str


class ExplainRequest(BaseModel):
    score: int
    risk_level: RiskLevel
    signals_detected: list[str]
    reasoning: str


SCORING_SYSTEM_PROMPT = """You are a compassionate triage assistant for SAMVEDNA, a mental well-being screening system for victims of crimes during investigation, trial, and rehabilitation.

IMPORTANT DISCLAIMERS (internal — do not repeat to user):
- This is a TRIAGE/SCREENING signal, NOT a clinical diagnosis.
- Adapt indicators from PHQ-9/GAD-7 style domains: sleep disturbance, fear/anxiety, social withdrawal, hopelessness, safety concerns, financial stress, legal process stress.
- Weight TREND heavily: if the last 3 check-ins show worsening scores, increase the current score accordingly.
- Be culturally sensitive to Indian context: code-mixed language (Hinglish, Tanglish), family/social stigma, legal delays, compensation delays, witness intimidation.

Return ONLY valid JSON with this exact schema:
{
  "score": <integer 0-100>,
  "risk_level": "low" | "moderate" | "high" | "critical",
  "signals_detected": [<array of short snake_case signal tags>],
  "reasoning": "<2-3 sentences in plain language explaining WHY this score, suitable for a counsellor dashboard>"
}

Risk level mapping:
- low: score 0-30
- moderate: score 31-55
- high: score 56-75
- critical: score 76-100

Signal tag examples: fear, sleep_disturbance, isolation, financial_stress, legal_stress, hopelessness, safety_concern, anxiety, social_withdrawal, threat_perception, depression_indicators, coping_active, recovery_progress"""


def _gemini_text(system: Optional[str], user: str, json_mode: bool = False) -> str:
    config_kwargs: dict = {"max_output_tokens": 1024}
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
        history_text = "\n\nRecent check-in history (oldest to newest):\n"
        for i, h in enumerate(reversed(req.recent_history), 1):
            history_text += f'  {i}. [{h.risk_level}, score={h.score}] "{h.transcript[:200]}"\n'

    trend_note = ""
    if len(req.recent_history) >= 3:
        recent_scores = [h.score for h in req.recent_history[:3]]
        if recent_scores[0] < recent_scores[1] < recent_scores[2]:
            trend_note = "\n⚠ TREND ALERT: Scores are worsening over last 3 check-ins — weight this heavily."

    return f"""Case context:
- Case type: {req.case_metadata.case_type}
- Days since case opened: {req.case_metadata.days_since_opened}
- Victim preferred language: {req.case_metadata.preferred_language}
{history_text}{trend_note}

Current check-in transcript:
\"\"\"{req.transcript}\"\"\"

Analyze distress level and return JSON only."""


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _fallback_score(req: ScoreRequest) -> ScoreResponse:
    """Rule-based fallback when Gemini API key is missing."""
    text = req.transcript.lower()
    signals = []
    score = 25

    keywords = {
        "fear": ("darr", "afraid", "scared", "bhay", "பயம்"),
        "sleep_disturbance": ("sleep", "neend", "insomnia", "நidra"),
        "hopelessness": ("hopeless", "kuch nahi", "nothing will", "நம்பிக்கை"),
        "safety_concern": ("threat", "message", "danger", "safe", "அச்சம்"),
        "financial_stress": ("money", "paise", "compensation", "kharcha", "பணம்"),
        "isolation": ("alone", "bahar nahi", "withdraw", "தனிமை"),
    }

    for signal, words in keywords.items():
        if any(w in text for w in words):
            signals.append(signal)
            score += 12

    if req.recent_history:
        avg = sum(h.score for h in req.recent_history[:3]) / min(3, len(req.recent_history))
        score = int(score * 0.6 + avg * 0.4)

    score = min(100, max(0, score))
    if score <= 30:
        risk = "low"
    elif score <= 55:
        risk = "moderate"
    elif score <= 75:
        risk = "high"
    else:
        risk = "critical"

    return ScoreResponse(
        score=score,
        risk_level=risk,
        signals_detected=signals or ["general_distress"],
        reasoning=(
            f"Fallback rule-based score ({score}/100). "
            f"Detected signals: {', '.join(signals) or 'none specific'}. "
            "Configure GEMINI_API_KEY for LLM-powered scoring."
        ),
    )


def _normalize_score(parsed: dict) -> ScoreResponse:
    score = min(100, max(0, int(parsed["score"])))
    if score <= 30:
        risk = "low"
    elif score <= 55:
        risk = "moderate"
    elif score <= 75:
        risk = "high"
    else:
        risk = "critical"

    return ScoreResponse(
        score=score,
        risk_level=risk,
        signals_detected=parsed.get("signals_detected", []),
        reasoning=parsed.get("reasoning", "Score computed from transcript analysis."),
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ml-service",
        "provider": "gemini",
        "model": GEMINI_MODEL,
        "gemini_configured": bool(GEMINI_API_KEY),
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
        raise HTTPException(status_code=500, detail=f"Scoring failed: {str(e)}")


@app.post("/explain")
async def explain_score(req: ExplainRequest):
    return {
        "score": req.score,
        "risk_level": req.risk_level,
        "signals_detected": req.signals_detected,
        "reasoning": req.reasoning,
        "disclaimer": "This explanation is LLM-generated rationale for triage screening, not a clinical diagnosis or formal feature attribution.",
    }


class ChatRequest(BaseModel):
    message: str
    preferred_language: str = "en"
    conversation_history: list[dict] = Field(default_factory=list)


@app.post("/chat")
async def chat_response(req: ChatRequest):
    lang_map = {"en": "English", "hi": "Hindi", "ta": "Tamil"}
    lang_name = lang_map.get(req.preferred_language, "English")

    if not GEMINI_API_KEY:
        return {
            "response": "Thank you for sharing. I'm here to listen whenever you're ready. (Configure GEMINI_API_KEY for full responses.)",
        }

    system = f"""You are Mann-Mitra, a warm and compassionate well-being companion for crime victims in India.
Respond in {lang_name}. If the user writes in code-mixed language (Hinglish/Tanglish), match their style naturally.
Ask ONE gentle question at a time. Never interrogate. Never diagnose. Be empathetic and culturally sensitive.
Keep responses under 3 sentences. This is a support check-in, not an emergency service."""

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
        # Fallback so chat still works if Gemini fails
        print(f"[Chat error] {e}")
        return {
            "response": (
                "Thank you for sharing that with me. Could you tell me a bit more about "
                "how your sleep and mood have been lately?"
            ),
        }
