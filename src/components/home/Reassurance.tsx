import { SectionLabel } from "@/components/ui/SectionLabel";

const items: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: "01 / Held",
    title: "Seats hold for ten minutes.",
    body:
      "Pick a row, take your time. The timer surfaces in the checkout header so nobody is rushed past a decision.",
  },
  {
    eyebrow: "02 / Included",
    title: "Internet, baggage, seat — yours.",
    body:
      "One published fare. Gigabit Wi-Fi, a checked bag, and your seat assignment are part of every ticket — no add-ons at the gate.",
  },
  {
    eyebrow: "03 / Recoverable",
    title: "PNR + email finds your trip.",
    body:
      "We don't gate manage-your-trip behind a login. Type your six-character record locator and the email on file. That's it.",
  },
];

export function Reassurance() {
  return (
    <section className="container-rams py-20 md:py-28 border-y border-[color:var(--rule)] bg-[color:var(--paper-2)]/40">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <SectionLabel index="03" label="Honest checkout" />
          <h2 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em] md:text-[56px]">
            What you see is what you pay.
          </h2>
        </div>
      </div>

      <div className="mt-12 grid gap-px bg-[color:var(--rule)] md:grid-cols-3">
        {items.map((item) => (
          <article key={item.title} className="bg-[color:var(--paper)] p-8">
            <p className="eyebrow">{item.eyebrow}</p>
            <h3 className="mt-6 font-display text-[28px] leading-[1.05] tracking-[-0.02em]">
              {item.title}
            </h3>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
