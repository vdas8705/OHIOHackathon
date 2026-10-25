import { Gauge, MessageCircleWarning, Hourglass, Scale } from "lucide-react";
import { displayPhrase, paceLabel, type DeliveryMetrics } from "../speech/delivery";

/** Live delivery coaching while answering by voice. Coaching only, never scored. */
export function DeliveryMeter({ metrics, listening }: { metrics: DeliveryMetrics | null; listening: boolean }) {
  if (!metrics && !listening) return null;
  const m = metrics;
  const items = [
    {
      icon: Gauge,
      label: "Pace",
      value: m?.wpm != null ? `${m.wpm} wpm` : "—",
      note: paceLabel(m?.wpm ?? null),
      flag: m?.wpm != null && (m.wpm < 110 || m.wpm > 170),
    },
    { icon: MessageCircleWarning, label: "Filler words", value: String(m?.filler_count ?? 0), note: topPhrase(m?.fillers), flag: (m?.filler_count ?? 0) >= 3 },
    { icon: Scale, label: "Hedging", value: String(m?.hedge_count ?? 0), note: topPhrase(m?.hedges), flag: (m?.hedge_count ?? 0) >= 3 },
    { icon: Hourglass, label: "Long pauses", value: String(m?.long_pauses ?? 0), note: "over 2.5s", flag: (m?.long_pauses ?? 0) >= 3 },
  ];

  return (
    <section className="delivery-meter comic-font mt-3" aria-label="Delivery coaching">
      <div className="delivery-meter__title">
        Delivery coach <span className="delivery-meter__hint">· coaching only, doesn't affect your score</span>
      </div>
      <ul className="delivery-meter__grid">
        {items.map((it) => (
          <li key={it.label} className={`delivery-meter__item ${it.flag ? "is-flagged" : ""}`}>
            <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="delivery-meter__label">{it.label}</span>
              <span className="delivery-meter__value">
                {it.value}
                {it.flag && <span className="sr-only"> (worth working on)</span>}
              </span>
              {it.note && <span className="delivery-meter__note">{it.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function topPhrase(counts?: Record<string, number>): string {
  if (!counts) return "";
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? `mostly "${displayPhrase(top[0])}"` : "";
}
