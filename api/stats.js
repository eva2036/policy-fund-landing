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
    const [clicks, visits, dwellTotal, dwellCount, s25, s50, s75, s100] = await Promise.all([
      getDayCounts(url, token, "kakao_clicks"),
      getDayCounts(url, token, "visits"),
      getDayCounts(url, token, "dwell_total"),
      getDayCounts(url, token, "dwell_count"),
      getDayCounts(url, token, "scroll_25"),
      getDayCounts(url, token, "scroll_50"),
      getDayCounts(url, token, "scroll_75"),
      getDayCounts(url, token, "scroll_100"),
    ]);

    const days = new Set([
      ...Object.keys(clicks), ...Object.keys(visits), ...Object.keys(dwellCount),
    ]);

    const byDay = {};
    Array.from(days).sort().forEach((d) => {
      const v = visits[d] || 0;
      const dc = dwellCount[d] || 0;
      const dt = dwellTotal[d] || 0;
      byDay[d] = {
        visits: v,
        clicks: clicks[d] || 0,
        avgDwellSec: dc ? Math.round(dt / dc) : 0,
        scroll25: v ? Math.round(((s25[d] || 0) / v) * 100) : 0,
        scroll50: v ? Math.round(((s50[d] || 0) / v) * 100) : 0,
        scroll75: v ? Math.round(((s75[d] || 0) / v) * 100) : 0,
        scroll100: v ? Math.round(((s100[d] || 0) / v) * 100) : 0,
      };
    });

    const total = Object.values(clicks).reduce((a, b) => a + b, 0);
    res.status(200).json({ total, byDay });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
