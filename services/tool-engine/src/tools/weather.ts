import type { Tool } from "../engine.ts";

// ADR-062: weather from Open-Meteo (free, no key, no account). Only the place name or coordinates leave the Mac.

export interface WeatherOptions {
  fetch?: typeof globalThis.fetch;
  /** Where "here" is when the user names no place: a city name (default: from the Mac's time zone, e.g. Tokyo). */
  home?: () => string;
  timeoutMs?: number;
}

const CODES: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light showers",
  81: "showers",
  82: "violent showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorms",
  96: "thunderstorms with hail",
  99: "thunderstorms with hail",
};

export function homeFromTimeZone(zone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const city = zone.split("/").at(-1) ?? "";
  return city.replace(/_/g, " ") || "Tokyo";
}

export function weatherTool(options: WeatherOptions = {}): Tool {
  const doFetch = options.fetch ?? globalThis.fetch;
  const home = options.home ?? (() => homeFromTimeZone());
  const timeoutMs = options.timeoutMs ?? 8000;

  async function getJson(url: string): Promise<Record<string, unknown>> {
    const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`the weather service answered ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    spec: {
      name: "weather",
      description:
        "Current weather and the forecast for the next days, for a place (city name) or, with no place, where the user is. " +
        "Use it for 'what's the weather', 'will it rain tomorrow', 'do I need a coat in Osaka on Friday'.",
      inputSchema: {
        type: "object",
        properties: {
          place: { type: "string", description: "City or town, e.g. 'Osaka' or 'Paris, France'. Omit for where the user is." },
          days: { type: "number", description: "Days of forecast including today, 1 to 7 (default 3)." },
        },
      },
    },
    async run(input) {
      const place = typeof input.place === "string" && input.place.trim() ? input.place.trim() : home();
      const days = Math.min(7, Math.max(1, typeof input.days === "number" ? Math.round(input.days) : 3));
      const name = place.split(",")[0].trim();
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`);
      const results = Array.isArray(geo.results) ? (geo.results as Record<string, unknown>[]) : [];
      const hint = place.includes(",") ? place.split(",").slice(1).join(",").trim().toLowerCase() : "";
      const match =
        (hint && results.find((r) => [r.country, r.country_code, r.admin1].some((v) => typeof v === "string" && v.toLowerCase() === hint))) ||
        results[0];
      if (!match) throw new Error(`no place called "${place}" was found`);
      const label = [match.name, match.admin1 !== match.name ? match.admin1 : undefined, match.country].filter(Boolean).join(", ");
      const forecast = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${match.latitude}&longitude=${match.longitude}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=auto&forecast_days=${days}`,
      );
      const c = (forecast.current ?? {}) as Record<string, number>;
      const d = (forecast.daily ?? {}) as Record<string, unknown[]>;
      const lines = [
        `${label} now: ${CODES[c.weather_code] ?? "unknown"}, ${Math.round(c.temperature_2m)}°C (feels ${Math.round(c.apparent_temperature)}°C), wind ${Math.round(c.wind_speed_10m)} km/h, humidity ${Math.round(c.relative_humidity_2m)}%.`,
      ];
      const dates = Array.isArray(d.time) ? (d.time as string[]) : [];
      dates.forEach((date, i) => {
        const day = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
        const rain = (d.precipitation_probability_max as number[] | undefined)?.[i];
        lines.push(
          `${i === 0 ? "Today" : day}: ${CODES[(d.weather_code as number[])[i]] ?? "unknown"}, ${Math.round((d.temperature_2m_min as number[])[i])} to ${Math.round((d.temperature_2m_max as number[])[i])}°C${typeof rain === "number" ? `, ${rain}% chance of rain` : ""}.`,
        );
      });
      return lines.join("\n");
    },
  };
}
