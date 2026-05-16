import { Hero } from "@/components/home/Hero";
import { TrendingDestinations } from "@/components/home/TrendingDestinations";
import { Reassurance } from "@/components/home/Reassurance";
import { NetworkOffline } from "@/components/home/NetworkOffline";
import { bookingApi, type Airport, type Route } from "@/lib/api";

// The home page calls a couple of backend endpoints that may take a moment
// to respond — and we want fresh data on every visit during the demo, not a
// build-time snapshot that may have rendered while the backend was down.
export const dynamic = "force-dynamic";

type LoadedData = {
  airports: Airport[];
  hubRoutes: { hub: Airport; routes: Route[] }[];
  cityByIata: Record<string, string>;
};

async function load(): Promise<LoadedData | { error: string }> {
  try {
    const { airports } = await bookingApi.airports();
    const hubs = airports.filter((airport) => airport.isHub).slice(0, 2);
    const cityByIata = Object.fromEntries(
      airports.map((airport) => [airport.iata, airport.city]),
    );

    const hubRoutes = await Promise.all(
      hubs.map(async (hub) => {
        const { routes } = await bookingApi.routes({ from: hub.iata });
        return { hub, routes };
      }),
    );

    return { airports, hubRoutes, cityByIata };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export default async function HomePage() {
  const result = await load();

  if ("error" in result) {
    return <NetworkOffline error={result.error} />;
  }

  return (
    <>
      <Hero airports={result.airports} />
      <Reassurance />
      {result.hubRoutes.map(({ hub, routes }) => (
        <TrendingDestinations
          key={hub.iata}
          hubIata={hub.iata}
          hubCity={hub.city}
          routes={routes.slice(0, 8)}
          cityByIata={result.cityByIata}
        />
      ))}
    </>
  );
}
