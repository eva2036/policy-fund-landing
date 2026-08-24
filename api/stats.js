async function getDayCounts(url, token, prefix) {
  const keysRes = await fetch(`${url}/keys/${prefix}:*`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { result: keys } = await keysRes.json();
  const counts = {};
  if (keys && keys.length) {
    const mgetRes = await fetch(`${url}/mget/${keys.join("/")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { result: values } = await mgetRes.json();
    keys.forEach((k, i) => {
      const day = k.replace(`${prefix}:`, "");
      counts[day] = parseInt(values[i] || "0", 10);
    });
  }
  return counts;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const secret = (process.env.STATS_SECRET || "").trim();
  if (!secret || req.query.key !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  try {
    const [
      kakaoClicks, formClicks, visits, dwellTotal, dwellCount,
      s25, s50, s75, s100,
      countries, cities, devices, browsers, oses, screens, langs, sources, utmSources, utmCampaigns,
    ] = await Promise.all([
      getDayCounts(url, token, "kakao_clicks"),
      getDayCounts(url, token, "form_clicks"),
      getDayCounts(url, token, "visits"),
      getDayCounts(url, token, "dwell_total"),
      getDayCounts(url, token, "dwell_count"),
      getDayCounts(url, token, "scroll_25"),
      getDayCounts(url, token, "scroll_50"),
      getDayCounts(url, token, "scroll_75"),
      getDayCounts(url, token, "scroll_100"),
      getDayCounts(url, token, "geo_country"),
      getDayCounts(url, token, "geo_city"),
      getDayCounts(url, token, "device"),
      getDayCounts(url, token, "browser"),
      getDayCounts(url, token, "os"),
      getDayCounts(url, token, "screen"),
      getDayCounts(url, token, "lang"),
      getDayCounts(url, token, "source"),
      getDayCounts(url, token, "utm_source"),
      getDayCounts(url, token, "utm_campaign"),
    ]);

    const days = new Set([
      ...Object.keys(kakaoClicks), ...Object.keys(formClicks),
      ...Object.keys(visits), ...Object.keys(dwellCount),
    ]);

    const byDay = {};
    Array.from(days).sort().forEach((d) => {
      const v = visits[d] || 0;
      const dc = dwellCount[d] || 0;
      const dt = dwellTotal[d] || 0;
      byDay[d] = {
        visits: v,
        clicksKakao: kakaoClicks[d] || 0,
        clicksForm: formClicks[d] || 0,
        avgDwellSec: dc ? Math.round(dt / dc) : 0,
        scroll25: v ? Math.round(((s25[d] || 0) / v) * 100) : 0,
        scroll50: v ? Math.round(((s50[d] || 0) / v) * 100) : 0,
        scroll75: v ? Math.round(((s75[d] || 0) / v) * 100) : 0,
        scroll100: v ? Math.round(((s100[d] || 0) / v) * 100) : 0,
      };
    });

    const totalKakao = Object.values(kakaoClicks).reduce((a, b) => a + b, 0);
    const totalForm = Object.values(formClicks).reduce((a, b) => a + b, 0);

    function toSortedList(obj, decode) {
      return Object.entries(obj)
        .map(([k, v]) => [decode ? decodeURIComponent(k) : k, v])
        .sort((a, b) => b[1] - a[1]);
    }

    res.status(200).json({
      totalKakao,
      totalForm,
      byDay,
      countries: toSortedList(countries, true),
      cities: toSortedList(cities, true),
      devices: toSortedList(devices, false),
      browsers: toSortedList(browsers, false),
      oses: toSortedList(oses, false),
      screens: toSortedList(screens, true),
      langs: toSortedList(langs, true),
      sources: toSortedList(sources, true),
      utmSources: toSortedList(utmSources, true),
      utmCampaigns: toSortedList(utmCampaigns, true),
    });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
