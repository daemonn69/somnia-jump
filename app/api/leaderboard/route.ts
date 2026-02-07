import { kv } from '@vercel/kv'
import { NextRequest, NextResponse } from 'next/server'

const LEADERBOARD_KEY = 'somnia-jump-leaderboard'
const MAX_ENTRIES = 100

interface LeaderboardEntry {
    address: string
    score: number
    timestamp: number
}

// GET - Получить лидерборд
export async function GET() {
    try {
        // Получаем топ-10 игроков (sorted set, от большего к меньшему)
        const entries = await kv.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })

        // Форматируем результат
        const leaderboard: LeaderboardEntry[] = []
        for (let i = 0; i < entries.length; i += 2) {
            const data = entries[i] as string
            const score = entries[i + 1] as number
            try {
                const parsed = JSON.parse(data)
                leaderboard.push({
                    address: parsed.address,
                    score: score,
                    timestamp: parsed.timestamp
                })
            } catch {
                // Skip invalid entries
            }
        }

        return NextResponse.json({ leaderboard })
    } catch (error) {
        console.error('Leaderboard GET error:', error)
        return NextResponse.json({ leaderboard: [] })
    }
}

// POST - Добавить результат
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { address, score } = body

        if (!address || typeof score !== 'number') {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
        }

        // Проверяем текущий лучший результат игрока
        const existingEntries = await kv.zrange(LEADERBOARD_KEY, 0, -1, { withScores: true })
        let existingScore = 0
        let existingKey = ''

        for (let i = 0; i < existingEntries.length; i += 2) {
            const data = existingEntries[i] as string
            try {
                const parsed = JSON.parse(data)
                if (parsed.address.toLowerCase() === address.toLowerCase()) {
                    existingScore = existingEntries[i + 1] as number
                    existingKey = data
                    break
                }
            } catch {
                // Skip
            }
        }

        // Сохраняем только если новый результат лучше
        if (score > existingScore) {
            // Удаляем старую запись если есть
            if (existingKey) {
                await kv.zrem(LEADERBOARD_KEY, existingKey)
            }

            // Добавляем новую запись
            const entry = JSON.stringify({
                address,
                timestamp: Date.now()
            })

            await kv.zadd(LEADERBOARD_KEY, { score, member: entry })

            // Ограничиваем размер лидерборда
            const count = await kv.zcard(LEADERBOARD_KEY)
            if (count > MAX_ENTRIES) {
                await kv.zremrangebyrank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
            }

            return NextResponse.json({ success: true, newHighScore: true })
        }

        return NextResponse.json({ success: true, newHighScore: false })
    } catch (error) {
        console.error('Leaderboard POST error:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
}
