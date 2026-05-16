export const site = {
  name: "FlyLo",
  longName: "FlyLo Airlines",
  product: "Booking",
  tagline: "Reserve your seat.",
  lede:
    "Browse the FlyLo network, hold a seat, and confirm your itinerary. Atlas Suite to Linen — every cabin, every continent.",
  iata: "FL",
  icao: "FLY",
  hqCity: "San Francisco",
  year: new Date().getUTCFullYear(),
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air",
};

export const nav: { label: string; href: string }[] = [
  { label: "Search", href: "/" },
  { label: "Trips", href: "/trips" },
  { label: "Help", href: "/help" },
];

export const footerNav: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Book",
    links: [
      { label: "Search flights", href: "/" },
      { label: "Manage trips", href: "/trips" },
      { label: "Find a reservation", href: "/trips#lookup" },
    ],
  },
  {
    heading: "Cabin",
    links: [
      { label: "Atlas Suite", href: `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air"}/cabin#atlas` },
      { label: "Prospect", href: `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air"}/cabin#prospect` },
      { label: "Linen", href: `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air"}/cabin#linen` },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About FlyLo", href: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air" },
      { label: "Network", href: `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air"}/network` },
      { label: "Journal", href: `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.flylo.air"}/journal` },
    ],
  },
  {
    heading: "Contact",
    links: [
      { label: "+1 (415) 580-0707", href: "tel:+14155800707" },
      { label: "contact@flylo.air", href: "mailto:contact@flylo.air" },
      { label: "Guest Care · 06:00–22:00 PT", href: "#" },
    ],
  },
];
