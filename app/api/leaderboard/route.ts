import { NextRequest, NextResponse } from 'next/server'

const LEADERBOARD_KEY = 'somnia-jump-leaderboard'
const MAX_ENTRIES = 100

interface LeaderboardEntry {
    address: string
    score: number
    timestamp: number
}

// In-memory fallback storage для локальной разработки
let inMemoryLeaderboard: LeaderboardEntry[] = []

// Проверяем доступность Vercel KV
let kvAvailable = false
let kv: any = null

try {
    // Пытаемся импортировать KV только если переменные окружения настроены
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        kv = require('@vercel/kv').kv
        kvAvailable = true
        console.log('✅ Vercel KV connected')
    } else {
        console.log('⚠️  Vercel KV not configured, using in-memory storage')
    }
} catch (error) {
    console.log('⚠️  Vercel KV not available, using in-memory storage')
}

// Функции для работы с in-memory storage
function getInMemoryLeaderboard(): LeaderboardEntry[] {
    return inMemoryLeaderboard
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
}

function saveToInMemoryLeaderboard(entry: LeaderboardEntry): boolean {
    // Ищем существующую запись для этого адреса
    const existingIndex = inMemoryLeaderboard.findIndex(
        e => e.address.toLowerCase() === entry.address.toLowerCase()
    )

    if (existingIndex >= 0) {
        // Обновляем только если новый результат лучше
        if (entry.score > inMemoryLeaderboard[existingIndex].score) {
            inMemoryLeaderboard[existingIndex] = entry
            return true
        }
        return false
    } else {
        // Новая запись
        inMemoryLeaderboard.push(entry)
        // Ограничиваем размер
        if (inMemoryLeaderboard.length > MAX_ENTRIES) {
            inMemoryLeaderboard = inMemoryLeaderboard
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_ENTRIES)
        }
        return true
    }
}

// GET - Получить лидерборд
export async function GET() {
    try {
        if (kvAvailable && kv) {
            // Используем Vercel KV
            const entries = await kv.zrange(LEADERBOARD_KEY, 0, 9, { rev: true, withScores: true })

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

            return NextResponse.json({ leaderboard, storage: 'kv' })
        } else {
            // Используем in-memory storage
            return NextResponse.json({
                leaderboard: getInMemoryLeaderboard(),
                storage: 'memory',
                warning: 'Using in-memory storage. Data will be lost on server restart. Configure Vercel KV for persistent storage.'
            })
        }
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

        if (kvAvailable && kv) {
            // Используем Vercel KV
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

            if (score > existingScore) {
                if (existingKey) {
                    await kv.zrem(LEADERBOARD_KEY, existingKey)
                }

                const entry = JSON.stringify({
                    address,
                    timestamp: Date.now()
                })

                await kv.zadd(LEADERBOARD_KEY, { score, member: entry })

                const count = await kv.zcard(LEADERBOARD_KEY)
                if (count > MAX_ENTRIES) {
                    await kv.zremrangebyrank(LEADERBOARD_KEY, 0, count - MAX_ENTRIES - 1)
                }

                return NextResponse.json({ success: true, newHighScore: true, storage: 'kv' })
            }

            return NextResponse.json({ success: true, newHighScore: false, storage: 'kv' })
        } else {
            // Используем in-memory storage
            const entry: LeaderboardEntry = {
                address,
                score,
                timestamp: Date.now()
            }

            const isNewHighScore = saveToInMemoryLeaderboard(entry)

            return NextResponse.json({
                success: true,
                newHighScore: isNewHighScore,
                storage: 'memory',
                warning: 'Using in-memory storage. Configure Vercel KV for persistent storage.'
            })
        }
    } catch (error) {
        console.error('Leaderboard POST error:', error)
        return NextResponse.json({ error: 'Failed to save score' }, { status: 500 })
    }
}
