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
    const keysRes = await fetch(`${url}/keys/kakao_clicks:*`, {
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
        const day = k.replace("kakao_clicks:", "");
        counts[day] = parseInt(values[i] || "0", 10);
      });
    }

    const sorted = Object.keys(counts)
      .sort()
      .reduce((acc, k) => { acc[k] = counts[k]; return acc; }, {});
    const total = Object.values(sorted).reduce((a, b) => a + b, 0);

    res.status(200).json({ total, byDay: sorted });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
}
