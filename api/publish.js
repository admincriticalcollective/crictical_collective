import {publishFramerProject} from '../lib/framer.js'

const HOUR_IN_MILLISECONDS = 60 * 60 * 1000

export function isPublishIntervalDue(now, intervalHours) {
  const elapsedHours = Math.floor(now.getTime() / HOUR_IN_MILLISECONDS)
  return elapsedHours % intervalHours === 0
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({error: 'method not allowed'})

  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(500).json({error: 'cron secret is not configured'})
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({error: 'unauthorized'})
  }

  const intervalHours = Number(process.env.FRAMER_PUBLISH_INTERVAL_HOURS || 24)
  if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
    return res.status(500).json({error: 'FRAMER_PUBLISH_INTERVAL_HOURS must be an integer from 1 to 24'})
  }
  if (!isPublishIntervalDue(new Date(), intervalHours)) {
    return res.status(200).json({ok: true, skipped: true, intervalHours})
  }

  try {
    const result = await publishFramerProject()
    return res.status(200).json({ok: true, intervalHours, ...result})
  } catch (error) {
    console.error('Scheduled Framer publish failed:', error.message)
    return res.status(500).json({error: 'publish failed'})
  }
}