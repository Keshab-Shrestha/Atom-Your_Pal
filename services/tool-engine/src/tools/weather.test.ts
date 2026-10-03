import { test } from "node:test";
import assert from "node:assert/strict";
import { homeFromTimeZone, weatherTool } from "./weather.ts";

function fakeFetch(geo: unknown, forecast: unknown) {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(String(url));
    const body = String(url).includes("geocoding") ? geo : forecast;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

const forecast = {
  current: { temperature_2m: 21.4, apparent_temperature: 20.6, weather_code: 2, wind_speed_10m: 11.2, relative_humidity_2m: 63 },
  daily: {
    time: ["2026-10-04", "2026-10-05"],
    weather_code: [2, 63],
    temperature_2m_min: [16.2, 15.1],
    temperature_2m_max: [24.8, 19.6],
    precipitation_probability_max: [10, 80],
  },
};

test("home comes from the Mac's time zone", () => {
  assert.equal(homeFromTimeZone("Asia/Tokyo"), "Tokyo");
  assert.equal(homeFromTimeZone("America/New_York"), "New York");
});

test("weather: geocodes, prefers the named country, and reads the forecast", async () => {
  const geo = {
    results: [
      { name: "Paris", admin1: "Texas", country: "United States", country_code: "US", latitude: 33.66, longitude: -95.55 },
      { name: "Paris", admin1: "Île-de-France", country: "France", country_code: "FR", latitude: 48.85, longitude: 2.35 },
    ],
  };
  const f = fakeFetch(geo, forecast);
  const text = String(await weatherTool({ fetch: f.fetch }).run({ place: "Paris, France", days: 2 }));
  assert.match(f.urls[1], /latitude=48.85&longitude=2.35/);
  assert.match(f.urls[1], /forecast_days=2/);
  assert.match(text, /^Paris, Île-de-France, France now: partly cloudy, 21°C \(feels 21°C\), wind 11 km\/h, humidity 63%\./);
  assert.match(text, /Today: partly cloudy, 16 to 25°C, 10% chance of rain\./);
  assert.match(text, /Monday 5 Oct: rain, 15 to 20°C, 80% chance of rain\./);
});

test("weather: no place means home; an unknown place is a clear error", async () => {
  const f = fakeFetch({ results: [{ name: "Tokyo", admin1: "Tokyo", country: "Japan", latitude: 35.69, longitude: 139.69 }] }, forecast);
  await weatherTool({ fetch: f.fetch, home: () => "Tokyo" }).run({});
  assert.match(f.urls[0], /name=Tokyo/);
  const none = fakeFetch({}, forecast);
  await assert.rejects(Promise.resolve().then(() => weatherTool({ fetch: none.fetch }).run({ place: "Xyzzyville" })), /no place called "Xyzzyville"/);
});
