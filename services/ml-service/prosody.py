"""
Vocal Stress Index from audio prosody analysis.

Extracts clinical-standard features from voice audio and computes a personal-baseline-relative
stress index. Falls back gracefully when praat-parselmouth is unavailable.

Population norms until baseline sample_count ≥ 3. Signs matter:
- Stress RAISES: F0 mean, F0 std, jitter, shimmer, pause ratio
- Stress LOWERS: HNR (breathy/strained phonation)
"""

from __future__ import annotations

import io
import math
from typing import Literal, Optional

import numpy as np
from scipy import signal as sp_signal

# Soft imports — gracefully degrade if heavy audio libs unavailable
try:
    import parselmouth
    from parselmouth.praat import call as praat_call

    HAS_PARSELMOUTH = True
except ImportError:
    HAS_PARSELMOUTH = False

try:
    import librosa

    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

Confidence = Literal["high", "medium", "low", "insufficient", "reduced"]
Extractor = Literal["parselmouth", "librosa", "numpy_fallback"]

# Population norms (estimated from literature on stressed speech)
# Used before personal baseline sample_count ≥ 3
POPULATION_NORMS = {
    "f0_mean": {"mean": 180.0, "std": 35.0},  # Hz
    "f0_std": {"mean": 25.0, "std": 10.0},  # Hz
    "jitter_local": {"mean": 0.8, "std": 0.4},  # %
    "shimmer_local": {"mean": 6.0, "std": 2.5},  # %
    "hnr_db": {"mean": 12.0, "std": 4.0},  # dB
    "pause_ratio": {"mean": 0.25, "std": 0.10},  # fraction
    "speech_rate": {"mean": 4.5, "std": 1.0},  # syllables/sec
}


def _sigmoid(x: float) -> float:
    """Bounded sigmoid for VSI computation."""
    return 1.0 / (1.0 + math.exp(-x))


def _z_score(value: float, mean: float, std: float) -> float:
    """Z-score with divide-by-zero guard."""
    return (value - mean) / std if std > 1e-9 else 0.0


def _compute_vsi(features: dict, baseline: Optional[dict]) -> tuple[float, Confidence]:
    """
    Vocal Stress Index = 100 · sigmoid(weighted z-score combo).
    
    Formula: 0.28·z(f0_mean) + 0.18·z(f0_std) + 0.16·z(jitter)
             + 0.14·z(shimmer) - 0.12·z(hnr) + 0.07·z(pause_ratio)
             + 0.05·z(|speech_rate - baseline|)
    
    Returns (VSI 0-100, confidence level).
    """
    use_baseline = baseline and baseline.get("sample_count", 0) >= 3

    if use_baseline:
        # Personal baseline (≥3 samples)
        z_f0_mean = _z_score(
            features["f0_mean"],
            baseline.get("f0_mean_mean", features["f0_mean"]),
            baseline.get("f0_mean_std", 1.0),
        )
        z_f0_std = _z_score(
            features["f0_std"],
            baseline.get("f0_std_mean", features["f0_std"]),
            baseline.get("f0_std_std", 1.0),
        )
        z_jitter = _z_score(
            features["jitter_local"],
            baseline.get("jitter_mean", features["jitter_local"]),
            baseline.get("jitter_std", 1.0),
        )
        z_shimmer = _z_score(
            features["shimmer_local"],
            baseline.get("shimmer_mean", features["shimmer_local"]),
            baseline.get("shimmer_std", 1.0),
        )
        z_hnr = _z_score(
            features["hnr_db"],
            baseline.get("hnr_mean", features["hnr_db"]),
            baseline.get("hnr_std", 1.0),
        )
        z_pause = _z_score(
            features["pause_ratio"],
            baseline.get("pause_ratio_mean", features["pause_ratio"]),
            baseline.get("pause_ratio_std", 1.0),
        )
        speech_baseline = baseline.get("speech_rate_mean", features["speech_rate"])
        z_speech = _z_score(
            abs(features["speech_rate"] - speech_baseline),
            0.0,
            baseline.get("speech_rate_std", 1.0),
        )
    else:
        # Population norms
        z_f0_mean = _z_score(
            features["f0_mean"],
            POPULATION_NORMS["f0_mean"]["mean"],
            POPULATION_NORMS["f0_mean"]["std"],
        )
        z_f0_std = _z_score(
            features["f0_std"],
            POPULATION_NORMS["f0_std"]["mean"],
            POPULATION_NORMS["f0_std"]["std"],
        )
        z_jitter = _z_score(
            features["jitter_local"],
            POPULATION_NORMS["jitter_local"]["mean"],
            POPULATION_NORMS["jitter_local"]["std"],
        )
        z_shimmer = _z_score(
            features["shimmer_local"],
            POPULATION_NORMS["shimmer_local"]["mean"],
            POPULATION_NORMS["shimmer_local"]["std"],
        )
        z_hnr = _z_score(
            features["hnr_db"],
            POPULATION_NORMS["hnr_db"]["mean"],
            POPULATION_NORMS["hnr_db"]["std"],
        )
        z_pause = _z_score(
            features["pause_ratio"],
            POPULATION_NORMS["pause_ratio"]["mean"],
            POPULATION_NORMS["pause_ratio"]["std"],
        )
        z_speech = _z_score(
            abs(features["speech_rate"] - POPULATION_NORMS["speech_rate"]["mean"]),
            0.0,
            POPULATION_NORMS["speech_rate"]["std"],
        )

    # Weighted composite (signs encode stress direction)
    weighted_z = (
        0.28 * z_f0_mean  # stress raises pitch
        + 0.18 * z_f0_std  # stress increases pitch variability
        + 0.16 * z_jitter  # stress increases jitter (vocal instability)
        + 0.14 * z_shimmer  # stress increases shimmer (amplitude instability)
        - 0.12 * z_hnr  # stress LOWERS HNR (breathy, strained phonation)
        + 0.07 * z_pause  # stress lengthens pauses
        + 0.05 * z_speech  # stress disrupts normal speech rate
    )

    vsi = 100.0 * _sigmoid(weighted_z)
    confidence: Confidence = "high" if use_baseline else "medium"
    return vsi, confidence


def _extract_with_parselmouth(audio_bytes: bytes, sample_rate: int) -> dict:
    """
    Extract prosody features using praat-parselmouth (clinical-standard).
    """
    sound = parselmouth.Sound(io.BytesIO(audio_bytes))
    if sample_rate:
        sound = sound.resample(sample_rate)

    duration = sound.duration
    pitch_floor, pitch_ceiling = 75, 500

    # F0 (pitch)
    pitch = praat_call(sound, "To Pitch", 0.0, pitch_floor, pitch_ceiling)
    f0_values = pitch.selected_array["frequency"]
    f0_values = f0_values[f0_values > 0]  # filter unvoiced frames

    f0_mean = float(np.mean(f0_values)) if len(f0_values) > 0 else 0.0
    f0_std = float(np.std(f0_values)) if len(f0_values) > 0 else 0.0
    f0_range = float(np.ptp(f0_values)) if len(f0_values) > 0 else 0.0

    # Jitter (local period perturbation)
    point_process = praat_call(
        sound, "To PointProcess (periodic, cc)", pitch_floor, pitch_ceiling
    )
    jitter_local = praat_call(
        point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3
    )
    jitter_local = float(jitter_local) * 100.0  # convert to %

    # Shimmer (local amplitude perturbation)
    shimmer_local = praat_call(
        [sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6
    )
    shimmer_local = float(shimmer_local) * 100.0  # convert to %

    # HNR (Harmonics-to-Noise Ratio)
    harmonicity = praat_call(sound, "To Harmonicity (cc)", 0.01, pitch_floor, 0.1, 1.0)
    hnr_db = float(praat_call(harmonicity, "Get mean", 0, 0))

    # Intensity (loudness)
    intensity = praat_call(sound, "To Intensity", pitch_floor, 0.0, "yes")
    intensity_values = praat_call(intensity, "List values", 0, 0, 1, "Hertz")
    intensity_values = np.array([float(v) for v in intensity_values if v])
    intensity_mean = float(np.mean(intensity_values)) if len(intensity_values) > 0 else 0.0
    intensity_std = float(np.std(intensity_values)) if len(intensity_values) > 0 else 0.0

    # Speech rate (syllable nuclei counting)
    silences = praat_call(
        intensity, "To TextGrid (silences)", -25, 0.25, 0.1, "silent", "sounding"
    )
    textgrid = praat_call(silences, "Into TextGrid")
    silence_tier = praat_call(textgrid, "Extract one tier", 1)
    num_intervals = praat_call(silence_tier, "Get number of intervals")

    voiced_duration = 0.0
    num_peaks = 0
    for i in range(1, num_intervals + 1):
        label = praat_call(silence_tier, "Get label of interval", i)
        if label == "sounding":
            start = praat_call(silence_tier, "Get start time of interval", i)
            end = praat_call(silence_tier, "Get end time of interval", i)
            voiced_duration += end - start

            # Count intensity peaks in this interval (syllable nuclei proxy)
            interval_intensity = praat_call(
                intensity, "Get mean", start, end, "energy"
            )
            if interval_intensity > 0:
                num_peaks += max(1, int((end - start) * 4.5))  # rough syllable estimate

    speech_rate = num_peaks / voiced_duration if voiced_duration > 0 else 0.0
    pause_ratio = (
        (duration - voiced_duration) / duration if duration > 0 else 0.0
    )

    # Spectral centroid (using librosa if available, else skip)
    spectral_centroid_mean = 0.0
    if HAS_LIBROSA:
        y = sound.values[0]
        sr = int(sound.sampling_frequency)
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
        spectral_centroid_mean = float(np.mean(centroid))

    return {
        "f0_mean": f0_mean,
        "f0_std": f0_std,
        "f0_range": f0_range,
        "jitter_local": jitter_local,
        "shimmer_local": shimmer_local,
        "hnr_db": hnr_db,
        "speech_rate": speech_rate,
        "pause_ratio": pause_ratio,
        "intensity_mean": intensity_mean,
        "intensity_std": intensity_std,
        "spectral_centroid_mean": spectral_centroid_mean,
        "duration": duration,
    }


def _extract_with_librosa(audio_bytes: bytes, sample_rate: Optional[int]) -> dict:
    """
    Extract prosody features using librosa (less accurate than Parselmouth).
    """
    import tempfile
    
    # librosa needs a proper file, not bytes directly
    # Create a temporary WAV file
    try:
        # Try to load directly if it's already in a supported format
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=sample_rate)
    except Exception:
        # Fall back to writing temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            y, sr = librosa.load(tmp_path, sr=sample_rate)
        finally:
            import os
            os.unlink(tmp_path)
    
    duration = float(len(y) / sr)

    # F0 via librosa's piptrack
    pitches, magnitudes = librosa.piptrack(y=y, sr=sr, fmin=75, fmax=500)
    pitch_values = []
    for t in range(pitches.shape[1]):
        index = magnitudes[:, t].argmax()
        pitch = pitches[index, t]
        if pitch > 0:
            pitch_values.append(pitch)

    f0_mean = float(np.mean(pitch_values)) if pitch_values else 0.0
    f0_std = float(np.std(pitch_values)) if pitch_values else 0.0
    f0_range = float(np.ptp(pitch_values)) if pitch_values else 0.0

    # Jitter/shimmer approximations (not clinical-standard)
    jitter_local = f0_std / f0_mean * 100.0 if f0_mean > 0 else 0.0
    rms = librosa.feature.rms(y=y)
    shimmer_local = float(np.std(rms) / np.mean(rms) * 100.0) if np.mean(rms) > 0 else 0.0

    # HNR approximation (spectral flatness inverse proxy)
    spectral_flatness = librosa.feature.spectral_flatness(y=y)
    hnr_db = -10 * float(np.log10(np.mean(spectral_flatness) + 1e-10))

    # Speech rate (zero-crossing rate proxy)
    zcr = librosa.feature.zero_crossing_rate(y)
    speech_rate = float(np.mean(zcr)) * 10.0  # rough syllable rate estimate

    # Pause ratio (low-energy frames)
    rms_threshold = np.percentile(rms, 25)
    pause_frames = np.sum(rms < rms_threshold)
    pause_ratio = pause_frames / len(rms[0]) if len(rms[0]) > 0 else 0.0

    # Intensity
    intensity_db = librosa.amplitude_to_db(rms, ref=np.max)
    intensity_mean = float(np.mean(intensity_db))
    intensity_std = float(np.std(intensity_db))

    # Spectral centroid
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
    spectral_centroid_mean = float(np.mean(centroid))

    return {
        "f0_mean": f0_mean,
        "f0_std": f0_std,
        "f0_range": f0_range,
        "jitter_local": jitter_local,
        "shimmer_local": shimmer_local,
        "hnr_db": hnr_db,
        "speech_rate": speech_rate,
        "pause_ratio": pause_ratio,
        "intensity_mean": intensity_mean,
        "intensity_std": intensity_std,
        "spectral_centroid_mean": spectral_centroid_mean,
        "duration": duration,
    }


def _extract_with_numpy_fallback(audio_bytes: bytes, sample_rate: Optional[int]) -> dict:
    """
    Minimal numpy-based feature extraction when neither Parselmouth nor librosa available.
    Uses autocorrelation for pitch, simple energy measures. Confidence marked as "reduced".
    """
    # Decode bytes to numpy (assume 16-bit PCM mono for simplicity)
    # In production you'd use soundfile or wave module, but keeping dependencies minimal
    arr = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    sr = sample_rate or 16000
    duration = len(arr) / sr

    # Autocorrelation-based pitch estimation
    def autocorr_pitch(signal, sr, min_lag=None, max_lag=None):
        if min_lag is None:
            min_lag = int(sr / 500)  # 500 Hz ceiling
        if max_lag is None:
            max_lag = int(sr / 75)  # 75 Hz floor

        corr = np.correlate(signal, signal, mode="full")
        corr = corr[len(corr) // 2 :]  # take positive lags
        corr = corr[min_lag:max_lag]
        if len(corr) == 0:
            return 0.0
        peak = np.argmax(corr) + min_lag
        return sr / peak if peak > 0 else 0.0

    # Sliding window pitch
    frame_size = int(0.05 * sr)  # 50ms frames
    hop = frame_size // 2
    pitch_values = []
    for start in range(0, len(arr) - frame_size, hop):
        frame = arr[start : start + frame_size]
        pitch = autocorr_pitch(frame, sr)
        if pitch > 0:
            pitch_values.append(pitch)

    f0_mean = float(np.mean(pitch_values)) if pitch_values else 0.0
    f0_std = float(np.std(pitch_values)) if pitch_values else 0.0
    f0_range = float(np.ptp(pitch_values)) if pitch_values else 0.0

    # Jitter/shimmer rough approximations
    jitter_local = (f0_std / f0_mean * 100.0) if f0_mean > 0 else 0.0

    # Frame energy
    energy = np.array([np.sum(arr[i : i + frame_size] ** 2) for i in range(0, len(arr) - frame_size, hop)])
    energy_db = 10 * np.log10(energy + 1e-10)
    shimmer_local = float(np.std(energy_db) / (np.mean(energy_db) + 1e-10) * 100.0)

    # HNR proxy (energy variance — high variance = low HNR)
    hnr_db = 15.0 - float(np.std(energy_db))  # rough inverse relationship

    # Speech rate (zero-crossings proxy)
    zero_crossings = np.sum(np.abs(np.diff(np.sign(arr))))
    speech_rate = zero_crossings / duration / 200.0  # rough syllable estimate

    # Pause ratio (low-energy frames)
    threshold = np.percentile(energy_db, 25)
    pause_ratio = np.sum(energy_db < threshold) / len(energy_db) if len(energy_db) > 0 else 0.0

    # Intensity
    intensity_mean = float(np.mean(energy_db))
    intensity_std = float(np.std(energy_db))

    # Spectral centroid (FFT-based)
    spectrum = np.abs(np.fft.rfft(arr))
    freqs = np.fft.rfftfreq(len(arr), 1 / sr)
    spectral_centroid_mean = float(np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-10))

    return {
        "f0_mean": f0_mean,
        "f0_std": f0_std,
        "f0_range": f0_range,
        "jitter_local": jitter_local,
        "shimmer_local": shimmer_local,
        "hnr_db": hnr_db,
        "speech_rate": speech_rate,
        "pause_ratio": pause_ratio,
        "intensity_mean": intensity_mean,
        "intensity_std": intensity_std,
        "spectral_centroid_mean": spectral_centroid_mean,
        "duration": duration,
    }


def analyse_voice(
    audio_bytes: bytes,
    sample_rate: Optional[int] = None,
    baseline: Optional[dict] = None,
) -> dict:
    """
    Analyse voice audio and compute Vocal Stress Index (VSI).

    Args:
        audio_bytes: Raw audio bytes (webm/opus, wav, etc)
        sample_rate: Optional sample rate hint
        baseline: Optional personal baseline dict with feature means/stds and sample_count

    Returns:
        {
            f0_mean, f0_std, f0_range,
            jitter_local, shimmer_local, hnr_db,
            speech_rate, pause_ratio,
            intensity_mean, intensity_std,
            spectral_centroid_mean,
            vocal_stress_index: 0-100 or None if duration < 5s,
            confidence: "high"|"medium"|"low"|"insufficient"|"reduced",
            extractor: "parselmouth"|"librosa"|"numpy_fallback",
            baseline_deviation: float (only if baseline provided),
            features_raw: dict
        }
    """
    # Choose extractor based on available libraries
    extractor: Extractor
    if HAS_PARSELMOUTH:
        extractor = "parselmouth"
        features = _extract_with_parselmouth(audio_bytes, sample_rate or 16000)
    elif HAS_LIBROSA:
        extractor = "librosa"
        features = _extract_with_librosa(audio_bytes, sample_rate)
    else:
        extractor = "numpy_fallback"
        features = _extract_with_numpy_fallback(audio_bytes, sample_rate)

    duration = features["duration"]

    # Insufficient audio
    if duration < 5.0:
        return {
            **features,
            "vocal_stress_index": None,
            "confidence": "insufficient",
            "extractor": extractor,
            "baseline_deviation": None,
            "features_raw": features,
        }

    # Compute VSI
    vsi, confidence = _compute_vsi(features, baseline)

    # Adjust confidence if using numpy fallback
    if extractor == "numpy_fallback":
        confidence = "reduced"

    # Adjust confidence based on duration
    if duration < 15.0:
        if confidence == "high":
            confidence = "medium"

    # Baseline deviation (Euclidean distance in z-score space)
    baseline_deviation = None
    if baseline and baseline.get("sample_count", 0) >= 3:
        deviations = []
        for feat in ["f0_mean", "f0_std", "jitter_local", "shimmer_local", "hnr_db", "pause_ratio"]:
            z = _z_score(
                features[feat],
                baseline.get(f"{feat}_mean", features[feat]),
                baseline.get(f"{feat}_std", 1.0),
            )
            deviations.append(z**2)
        baseline_deviation = float(np.sqrt(np.mean(deviations)))

    return {
        "f0_mean": features["f0_mean"],
        "f0_std": features["f0_std"],
        "f0_range": features["f0_range"],
        "jitter_local": features["jitter_local"],
        "shimmer_local": features["shimmer_local"],
        "hnr_db": features["hnr_db"],
        "speech_rate": features["speech_rate"],
        "pause_ratio": features["pause_ratio"],
        "intensity_mean": features["intensity_mean"],
        "intensity_std": features["intensity_std"],
        "spectral_centroid_mean": features["spectral_centroid_mean"],
        "vocal_stress_index": round(vsi, 2),
        "confidence": confidence,
        "extractor": extractor,
        "baseline_deviation": round(baseline_deviation, 3) if baseline_deviation else None,
        "features_raw": features,
    }
