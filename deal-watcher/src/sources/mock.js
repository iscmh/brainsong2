/** Deterministic fake source - lets you exercise the whole pipeline (and Telegram) with no network. */

export const kind = 'mock';

export async function createSession({ source }) {
  const base = source.basePrice ?? 1450;
  return {
    async search({ stay, occupancySummary: occ }) {
      // A cheap pseudo-random walk seeded by the date, so runs are reproducible.
      const seed = [...stay.checkIn].reduce((a, c) => a + c.charCodeAt(0), 0);
      const wobble = ((seed * 37) % 23) - 11;
      const weekend = [5, 6].includes(new Date(`${stay.checkIn}T00:00:00Z`).getUTCDay()) ? 60 : 0;
      const price = base + wobble * 12 + weekend + (occ.adults - 3) * 180 + occ.childAges.length * 90;
      if ((seed + occ.adults) % 11 === 0) return []; // sometimes sold out
      return [
        { title: 'Family Room Sea View (mock)', board: 'Ultra All Inclusive', price, currency: 'EUR', url: 'https://example.com/mock' },
        { title: 'Double Room Park View (mock)', board: 'Ultra All Inclusive', price: price + 140, currency: 'EUR', url: 'https://example.com/mock' },
      ];
    },
    async close() {},
  };
}
