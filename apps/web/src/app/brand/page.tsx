"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  SamvednaLogo,
  SamvednaMark,
} from "@/components/samvedna-logo";
import { ArrowLeft, Check, Copy, Download, Heart, Shield, Sparkles, Volume2 } from "lucide-react";

export default function BrandShowcasePage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<number>(64);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("dark");
  const [isAnimated, setIsAnimated] = useState<boolean>(true);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadSvg = (filename: string, path: string) => {
    const a = document.createElement("a");
    a.href = path;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-[#fdfbf7] text-[#14211f] transition-colors selection:bg-teal-500/20">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-[#e8dcc8]/70 bg-[#fdfbf7]/90 backdrop-blur-md px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-[#5a6b69] hover:text-[#14211f] transition"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to App</span>
            </Link>
            <div className="h-4 w-px bg-[#e8dcc8]" />
            <span className="text-xs font-semibold tracking-widest uppercase text-teal-800">
              Brand Identity & Logo System
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-full bg-teal-800 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-900 transition"
            >
              Launch Portal
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12 space-y-20">
        {/* HERO HEADER */}
        <section className="text-center max-w-3xl mx-auto space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50/60 px-3.5 py-1 text-xs font-medium text-teal-900">
            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            Official Visual Identity
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight text-[#14211f]">
            Samvedna Brand System
          </h1>
          <p className="font-display italic text-lg sm:text-xl text-teal-900/80">
            संवेदना — listening beyond words
          </p>
          <p className="text-base text-[#5a6b69] max-w-2xl mx-auto leading-relaxed">
            A visual emblem engineered for trauma-informed dignity, combining protective sanctuary hands,
            a resilient blooming lotus, the human heart, and acoustic ripples that represent empathetic listening.
          </p>
        </section>

        {/* PRIMARY SHOWCASE HERO */}
        <section className="rounded-3xl border border-[#e8dcc8] bg-white p-8 sm:p-12 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 right-0 -mr-20 -mt-20 h-72 w-72 rounded-full bg-teal-500/5 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 -ml-20 -mb-20 h-72 w-72 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left: Interactive Canvas */}
            <div
              className={`rounded-2xl p-10 flex flex-col items-center justify-center min-h-[380px] transition-colors border ${
                previewTheme === "dark"
                  ? "bg-[#0a1f1d] border-teal-900/60 shadow-inner"
                  : "bg-[#faf8f5] border-[#e8dcc8]"
              }`}
            >
              <div className="p-6 transition-all">
                <SamvednaMark size={previewSize * 2} animated={isAnimated} />
              </div>
              <div className="mt-4 text-center">
                <p
                  className={`font-display font-semibold tracking-widest text-lg ${
                    previewTheme === "dark" ? "text-[#fdfbf7]" : "text-[#14211f]"
                  }`}
                >
                  SAMVEDNA
                </p>
                <p
                  className={`text-xs mt-0.5 tracking-wider ${
                    previewTheme === "dark" ? "text-teal-300/80" : "text-teal-800"
                  }`}
                >
                  संवेदना · listening beyond words
                </p>
              </div>
            </div>

            {/* Right: Controls & Actions */}
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-display font-semibold text-[#14211f]">
                  The Central Mark
                </h3>
                <p className="text-sm text-[#5a6b69] mt-1">
                  Adjust scale, ambient mode, and motion to test visual harmony across responsive breakpoints.
                </p>
              </div>

              {/* Controls */}
              <div className="space-y-4 rounded-2xl bg-[#faf8f5] p-5 border border-[#e8dcc8]/80 text-sm">
                {/* Size Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-[#5a6b69]">
                    <span>Symbol Scale</span>
                    <span className="font-mono font-medium text-[#14211f]">{previewSize * 2}px</span>
                  </div>
                  <input
                    type="range"
                    min="24"
                    max="110"
                    value={previewSize}
                    onChange={(e) => setPreviewSize(Number(e.target.value))}
                    className="w-full accent-teal-700 cursor-pointer"
                  />
                </div>

                {/* Theme & Animation Toggles */}
                <div className="flex flex-wrap gap-4 pt-2 border-t border-[#e8dcc8]/60">
                  <div>
                    <label className="text-xs text-[#5a6b69] block mb-1">Canvas Backdrop</label>
                    <div className="inline-flex rounded-lg border border-[#e8dcc8] p-0.5 bg-white text-xs">
                      <button
                        onClick={() => setPreviewTheme("dark")}
                        className={`px-3 py-1 rounded-md transition ${
                          previewTheme === "dark"
                            ? "bg-teal-900 text-white font-medium shadow-xs"
                            : "text-[#5a6b69]"
                        }`}
                      >
                        Sanctuary Dark
                      </button>
                      <button
                        onClick={() => setPreviewTheme("light")}
                        className={`px-3 py-1 rounded-md transition ${
                          previewTheme === "light"
                            ? "bg-teal-900 text-white font-medium shadow-xs"
                            : "text-[#5a6b69]"
                        }`}
                      >
                        Warm Ivory
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-[#5a6b69] block mb-1">Listening Pulse</label>
                    <button
                      onClick={() => setIsAnimated(!isAnimated)}
                      className={`px-3 py-1 rounded-lg border text-xs transition ${
                        isAnimated
                          ? "bg-teal-50 border-teal-600 text-teal-900 font-medium"
                          : "bg-white border-[#e8dcc8] text-[#5a6b69]"
                      }`}
                    >
                      {isAnimated ? "Pulse Active" : "Static State"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Downloads */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => downloadSvg("samvedna-icon.svg", "/samvedna-icon.svg")}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-teal-900 transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Vector Mark (.SVG)
                </button>
                <button
                  onClick={() => downloadSvg("samvedna-emblem.svg", "/samvedna-emblem.svg")}
                  className="inline-flex items-center gap-2 rounded-xl border border-teal-800/30 bg-white px-4 py-2 text-xs font-medium text-teal-900 hover:bg-teal-50 transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Shield Emblem
                </button>
                <button
                  onClick={() => downloadSvg("samvedna-logo-horizontal.svg", "/samvedna-logo-horizontal.svg")}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e8dcc8] bg-white px-4 py-2 text-xs font-medium text-[#5a6b69] hover:text-[#14211f] transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  Horizontal Lockup
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* LOGO VARIANTS GRID */}
        <section className="space-y-6">
          <div className="border-b border-[#e8dcc8] pb-4">
            <h2 className="text-2xl font-display font-semibold text-[#14211f]">
              System Variations
            </h2>
            <p className="text-sm text-[#5a6b69] mt-1">
              Curated form factors engineered for application navigation, official documentation, portals, and mobile app icons.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Card 1: Horizontal Lockup */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                  Primary Lockup
                </span>
                <p className="text-xs text-[#5a6b69] mt-0.5">For website headers and official portals</p>
              </div>
              <div className="py-6 flex items-center justify-center bg-[#faf8f5] rounded-xl border border-[#e8dcc8]/60 min-h-[140px]">
                <SamvednaLogo variant="horizontal" size="md" />
              </div>
              <button
                onClick={() => downloadSvg("samvedna-logo-horizontal.svg", "/samvedna-logo-horizontal.svg")}
                className="w-full text-center text-xs text-teal-800 font-medium py-2 rounded-lg hover:bg-teal-50 transition"
              >
                Download SVG
              </button>
            </div>

            {/* Card 2: App Icon / Emblem */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                  Shield Emblem
                </span>
                <p className="text-xs text-[#5a6b69] mt-0.5">Squircle container for mobile & avatar</p>
              </div>
              <div className="py-6 flex items-center justify-center bg-[#faf8f5] rounded-xl border border-[#e8dcc8]/60 min-h-[140px]">
                <SamvednaLogo variant="emblem" size="lg" />
              </div>
              <button
                onClick={() => downloadSvg("samvedna-emblem.svg", "/samvedna-emblem.svg")}
                className="w-full text-center text-xs text-teal-800 font-medium py-2 rounded-lg hover:bg-teal-50 transition"
              >
                Download Emblem
              </button>
            </div>

            {/* Card 3: Stacked Brand Mark */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                  Stacked Presentation
                </span>
                <p className="text-xs text-[#5a6b69] mt-0.5">For splash screens and login cards</p>
              </div>
              <div className="py-6 flex items-center justify-center bg-[#faf8f5] rounded-xl border border-[#e8dcc8]/60 min-h-[140px]">
                <SamvednaLogo variant="stacked" size="sm" />
              </div>
              <button
                onClick={() => downloadSvg("samvedna-icon.svg", "/samvedna-icon.svg")}
                className="w-full text-center text-xs text-teal-800 font-medium py-2 rounded-lg hover:bg-teal-50 transition"
              >
                Download Icon
              </button>
            </div>

            {/* Card 4: Dark Mode Lockup */}
            <div className="rounded-2xl border border-teal-900 bg-[#0a1f1d] p-6 space-y-4 shadow-sm flex flex-col justify-between text-[#fdfbf7]">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-400">
                  Dark Mode Lockup
                </span>
                <p className="text-xs text-[#93a19f] mt-0.5">High contrast for dark dashboards</p>
              </div>
              <div className="py-6 flex items-center justify-center bg-[#071715] rounded-xl border border-teal-900/60 min-h-[140px]">
                <SamvednaLogo variant="horizontal" size="md" theme="dark" />
              </div>
              <button
                onClick={() => downloadSvg("samvedna-logo-horizontal-dark.svg", "/samvedna-logo-horizontal-dark.svg")}
                className="w-full text-center text-xs text-teal-300 font-medium py-2 rounded-lg hover:bg-teal-900/50 transition"
              >
                Download Dark SVG
              </button>
            </div>

            {/* Card 5: Pill Badge */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                  Status Badge
                </span>
                <p className="text-xs text-[#5a6b69] mt-0.5">For compact breadcrumbs and chips</p>
              </div>
              <div className="py-6 flex items-center justify-center bg-[#faf8f5] rounded-xl border border-[#e8dcc8]/60 min-h-[140px]">
                <SamvednaLogo variant="badge" size="sm" />
              </div>
              <button
                onClick={() => copyToClipboard('<SamvednaLogo variant="badge" />', "badge")}
                className="w-full text-center text-xs text-teal-800 font-medium py-2 rounded-lg hover:bg-teal-50 transition"
              >
                {copied === "badge" ? "Copied JSX!" : "Copy Component JSX"}
              </button>
            </div>

            {/* Card 6: Pure Favicon Mark */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-6 space-y-4 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800">
                  App Favicon (16-32px)
                </span>
                <p className="text-xs text-[#5a6b69] mt-0.5">Clarity at micro-resolutions</p>
              </div>
              <div className="py-6 flex items-center justify-center gap-6 bg-[#faf8f5] rounded-xl border border-[#e8dcc8]/60 min-h-[140px]">
                <div className="flex flex-col items-center gap-1">
                  <SamvednaMark size={16} />
                  <span className="text-[10px] text-[#5a6b69]">16px</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <SamvednaMark size={24} />
                  <span className="text-[10px] text-[#5a6b69]">24px</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <SamvednaMark size={32} />
                  <span className="text-[10px] text-[#5a6b69]">32px</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <SamvednaMark size={48} />
                  <span className="text-[10px] text-[#5a6b69]">48px</span>
                </div>
              </div>
              <button
                onClick={() => downloadSvg("samvedna-icon.svg", "/samvedna-icon.svg")}
                className="w-full text-center text-xs text-teal-800 font-medium py-2 rounded-lg hover:bg-teal-50 transition"
              >
                Download Favicon
              </button>
            </div>
          </div>
        </section>

        {/* ANATOMY & SYMBOLOGY BREAKDOWN */}
        <section className="space-y-8">
          <div className="border-b border-[#e8dcc8] pb-4">
            <h2 className="text-2xl font-display font-semibold text-[#14211f]">
              Design Symbology & Anatomy
            </h2>
            <p className="text-sm text-[#5a6b69] mt-1">
              Every curve of the Samvedna emblem is rooted in healing, trauma recovery, constitutional dignity, and active listening.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex items-start gap-4 p-5 rounded-2xl bg-white border border-[#e8dcc8]">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 border border-teal-200 text-teal-800">
                <Shield className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-semibold text-[#14211f] text-base">
                  1. The Protective Sanctuary Hands (Outer Wings)
                </h4>
                <p className="text-sm text-[#5a6b69] leading-relaxed">
                  Sculpted flowing curves wrap around the core, evoking two gentle hands forming an unconditional safe harbor.
                  Symbolizes the constitutional protection and institutional shelter provided to SC/ST complainants and survivors.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-2xl bg-white border border-[#e8dcc8]">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                <Volume2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-semibold text-[#14211f] text-base">
                  2. Acoustic Resonance Waves (&ldquo;Listening Beyond Words&rdquo;)
                </h4>
                <p className="text-sm text-[#5a6b69] leading-relaxed">
                  Concentric golden arcs expanding outward depict voice frequency and acoustic resonance.
                  Reflects the platform&rsquo;s core capability: capturing micro-signals of distress in survivor speech, IVRS calls, and chatbot dialogues before a crisis occurs.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-2xl bg-white border border-[#e8dcc8]">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
                <Heart className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-semibold text-[#14211f] text-base">
                  3. The Inner Lotus Petals & Heart of Empathy (संवेदना)
                </h4>
                <p className="text-sm text-[#5a6b69] leading-relaxed">
                  The central vessel blends an organic lotus petal rising from mud with a vibrant heart contour in warm terracotta.
                  It signifies emotional solidarity, human healing, and dignity reborn through compassionate care.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-2xl bg-white border border-[#e8dcc8]">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-semibold text-[#14211f] text-base">
                  4. The Radiant Bindu (Attentive Awareness)
                </h4>
                <p className="text-sm text-[#5a6b69] leading-relaxed">
                  At the apex sits the golden Bindu (representing the Anusvara dot in संवेदना).
                  It stands for conscious attention, the spark of hope, and the steady human connection between the survivor, the counsellor, and the community.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* COLOR PALETTE & DESIGN SYSTEM */}
        <section className="space-y-6">
          <div className="border-b border-[#e8dcc8] pb-4">
            <h2 className="text-2xl font-display font-semibold text-[#14211f]">
              Harmonious Color Palette
            </h2>
            <p className="text-sm text-[#5a6b69] mt-1">
              Rooted in natural sanctuary tones of Indian terracotta, deep mineral teal, healing sage, and sunlit saffron.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Color 1 */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-4 space-y-3">
              <div className="h-20 w-full rounded-xl bg-[#0f6f65]" />
              <div>
                <p className="text-xs font-semibold text-[#14211f]">Sanctuary Teal</p>
                <p className="text-[11px] font-mono text-[#5a6b69]">#0F6F65</p>
                <p className="text-[10px] text-teal-800 mt-1">Healing & trust</p>
              </div>
            </div>

            {/* Color 2 */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-4 space-y-3">
              <div className="h-20 w-full rounded-xl bg-[#c97b5a]" />
              <div>
                <p className="text-xs font-semibold text-[#14211f]">Terracotta Clay</p>
                <p className="text-[11px] font-mono text-[#5a6b69]">#C97B5A</p>
                <p className="text-[10px] text-amber-800 mt-1">Warmth & human soil</p>
              </div>
            </div>

            {/* Color 3 */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-4 space-y-3">
              <div className="h-20 w-full rounded-xl bg-[#ffd166]" />
              <div>
                <p className="text-xs font-semibold text-[#14211f]">Saffron Amber</p>
                <p className="text-[11px] font-mono text-[#5a6b69]">#FFD166</p>
                <p className="text-[10px] text-amber-700 mt-1">Aspiration & light</p>
              </div>
            </div>

            {/* Color 4 */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-4 space-y-3">
              <div className="h-20 w-full rounded-xl bg-[#52b788]" />
              <div>
                <p className="text-xs font-semibold text-[#14211f]">Renewal Sage</p>
                <p className="text-[11px] font-mono text-[#5a6b69]">#52B788</p>
                <p className="text-[10px] text-emerald-800 mt-1">Growth & recovery</p>
              </div>
            </div>

            {/* Color 5 */}
            <div className="rounded-2xl border border-[#e8dcc8] bg-white p-4 space-y-3">
              <div className="h-20 w-full rounded-xl bg-[#0a1f1d]" />
              <div>
                <p className="text-xs font-semibold text-[#14211f]">Sanctuary Forest</p>
                <p className="text-[11px] font-mono text-[#5a6b69]">#0A1F1D</p>
                <p className="text-[10px] text-gray-700 mt-1">Depth & quiet ground</p>
              </div>
            </div>
          </div>
        </section>

        {/* CODE INTEGRATION SNIPPET */}
        <section className="rounded-3xl border border-[#e8dcc8] bg-white p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-display font-semibold text-[#14211f]">
                Easy Code Integration
              </h3>
              <p className="text-sm text-[#5a6b69] mt-0.5">
                Import <code className="text-xs font-mono bg-teal-50 px-1 py-0.5 rounded text-teal-800">SamvednaLogo</code> into any Next.js/React page.
              </p>
            </div>
            <button
              onClick={() =>
                copyToClipboard(
                  `import { SamvednaLogo, SamvednaMark } from "@/components/samvedna-logo";\n\n// Examples:\n<SamvednaLogo variant="horizontal" size="md" />\n<SamvednaLogo variant="emblem" size="lg" />\n<SamvednaMark size={32} animated />`,
                  "code"
                )
              }
              className="inline-flex items-center gap-2 self-start rounded-xl border border-teal-800/30 bg-teal-50 px-4 py-2 text-xs font-medium text-teal-900 hover:bg-teal-100 transition"
            >
              {copied === "code" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Copied snippet!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Component Usage
                </>
              )}
            </button>
          </div>

          <pre className="rounded-2xl bg-[#0a1f1d] p-5 font-mono text-xs text-[#fdfbf7] overflow-x-auto leading-relaxed border border-teal-900/60">
            {`import { SamvednaLogo, SamvednaMark } from "@/components/samvedna-logo";

// 1. Primary horizontal navbar lockup
<SamvednaLogo variant="horizontal" size="sm" />

// 2. Square shield emblem for avatars or splash
<SamvednaLogo variant="emblem" size="lg" animated />

// 3. Compact brand pill badge
<SamvednaLogo variant="badge" />

// 4. Standalone scalable vector mark
<SamvednaMark size={40} animated />`}
          </pre>
        </section>
      </main>
    </div>
  );
}
