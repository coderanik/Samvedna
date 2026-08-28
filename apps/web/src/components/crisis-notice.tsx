import { CRISIS_HELPLINE } from "@/lib/utils";
import { Phone } from "lucide-react";

export function CrisisNotice({ locale = "en" }: { locale?: string }) {
  const text =
    locale === "hi"
      ? "यह एक सहायता उपकरण है, आपातकालीन सेवा नहीं।"
      : locale === "ta"
        ? "இது ஒரு ஆதரவு கருவி, அavசர சேவை அல்ல."
        : "This is a support tool, not an emergency service.";

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">{text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-amber-800">
        <span className="flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" />
          KIRAN Helpline: <strong>{CRISIS_HELPLINE}</strong> (24×7)
        </span>
        <span>Emergency: <strong>112</strong></span>
      </div>
    </div>
  );
}
