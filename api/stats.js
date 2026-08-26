async function redisCmd(url, token, cmd) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  return r.json();
}

async function getVisitLog(url, token, prefix, days) {
  const entries = [];
  await Promise.all(
    days.map(async (d) => {
      try {
        const r = await redisCmd(url, token, ["LRANGE", `${prefix}visit_log:${d}`, "0", "-1"]);
        const list = r.result || [];
        list.forEach((raw) => {
          try {
            const obj = JSON.parse(raw);
            obj.date = d;
            entries.push(obj);
          } catch (e) {}
        });
      } catch (e) {}
    })
  );
  entries.sort((a, b) => b.t - a.t);
  return entries.slice(0, 150);
}

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

// prefix: "" for V1(레거시, 승격 전) 데이터, "v2_" for V2.0 데이터
async function buildStats(url, token, prefix) {
  const [
    kakaoClicks, formClicks, consultClicks, visits, dwellTotal, dwellCount,
    s25, s50, s75, s100,
    countries, cities, devices, browsers, oses, screens, langs, sources, utmSources, utmCampaigns,
  ] = await Promise.all([
    getDayCounts(url, token, `${prefix}kakao_clicks`),
    getDayCounts(url, token, `${prefix}form_clicks`),
    getDayCounts(url, token, `${prefix}consult_clicks`),
    getDayCounts(url, token, `${prefix}visits`),
    getDayCounts(url, token, `${prefix}dwell_total`),
    getDayCounts(url, token, `${prefix}dwell_count`),
    getDayCounts(url, token, `${prefix}scroll_25`),
    getDayCounts(url, token, `${prefix}scroll_50`),
    getDayCounts(url, token, `${prefix}scroll_75`),
    getDayCounts(url, token, `${prefix}scroll_100`),
    getDayCounts(url, token, `${prefix}geo_country`),
    getDayCounts(url, token, `${prefix}geo_city`),
    getDayCounts(url, token, `${prefix}device`),
    getDayCounts(url, token, `${prefix}browser`),
    getDayCounts(url, token, `${prefix}os`),
    getDayCounts(url, token, `${prefix}screen`),
    getDayCounts(url, token, `${prefix}lang`),
    getDayCounts(url, token, `${prefix}source`),
    getDayCounts(url, token, `${prefix}utm_source`),
    getDayCounts(url, token, `${prefix}utm_campaign`),
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
      clicksConsult: consultClicks[d] || 0,
      avgDwellSec: dc ? Math.round(dt / dc) : 0,
      scroll25: v ? Math.round(((s25[d] || 0) / v) * 100) : 0,
      scroll50: v ? Math.round(((s50[d] || 0) / v) * 100) : 0,
      scroll75: v ? Math.round(((s75[d] || 0) / v) * 100) : 0,
      scroll100: v ? Math.round(((s100[d] || 0) / v) * 100) : 0,
    };
  });

  const totalKakao = Object.values(kakaoClicks).reduce((a, b) => a + b, 0);
  const totalForm = Object.values(formClicks).reduce((a, b) => a + b, 0);
  const totalConsult = Object.values(consultClicks).reduce((a, b) => a + b, 0);
  const totalVisits = Object.values(visits).reduce((a, b) => a + b, 0);

  const recentVisits = await getVisitLog(url, token, prefix, Array.from(days));

  function toSortedList(obj, decode) {
    return Object.entries(obj)
      .map(([k, v]) => [decode ? decodeURIComponent(k) : k, v])
      .sort((a, b) => b[1] - a[1]);
  }

  return {
    totalVisits,
    totalKakao,
    totalForm,
    totalConsult,
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
    recentVisits,
  };
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
    const [v1, v2] = await Promise.all([
      buildStats(url, token, ""),
      buildStats(url, token, "v2_"),
    ]);
    res.status(200).json({ v1, v2 });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
