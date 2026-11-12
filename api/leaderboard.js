const { Redis } = require('@upstash/redis');

let redis;
function getRedis() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Redis environment is not configured');
  if (!redis) redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  return redis;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const values = await getRedis().lrange('bomb-leaderboard', 0, 199);
    const records = values.map(value => {
      try { return typeof value === 'string' ? JSON.parse(value) : value; }
      catch { return null; }
    }).filter(record => record && typeof record.team === 'string' && Number.isFinite(record.seconds) && Number.isFinite(record.strikes));
    records.sort((a, b) => a.seconds - b.seconds || a.strikes - b.strikes || a.playedAt.localeCompare(b.playedAt));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ records: records.slice(0, 10) });
  } catch (error) {
    console.error('Leaderboard read failed:', error.message);
    return res.status(503).json({ error: '순위표를 불러오지 못했어요.' });
  }
};
