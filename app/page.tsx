'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, toHex } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import './game/game.css'

interface Platform {
    x: number
    y: number
    width: number
}

interface LeaderboardEntry {
    address: string
    score: number
    timestamp: number
}

export default function SomniaJumpGame() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [gameState, setGameState] = useState<'start' | 'playing' | 'paused' | 'gameover'>('start')
    const [score, setScore] = useState(0)
    const [highScore, setHighScore] = useState(0)
    const [savedToChain, setSavedToChain] = useState(false)
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
    const [showLeaderboard, setShowLeaderboard] = useState(false)
    const [savingToLeaderboard, setSavingToLeaderboard] = useState(false)

    // Blockchain hooks
    const { address, isConnected } = useAccount()
    const { data: txHash, sendTransaction, isPending: isSending, error: sendError } = useSendTransaction()
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

    // Game refs
    const gameRef = useRef({
        player: { x: 0, y: 0, vy: 0, width: 60, height: 60 },
        platforms: [] as Platform[],
        keys: { left: false, right: false },
        maxY: 0,
        animationId: 0
    })

    // Constants
    const CANVAS_WIDTH = 400
    const CANVAS_HEIGHT = 600
    const GRAVITY = 0.5
    const JUMP_VELOCITY = -15
    const MOVE_SPEED = 8
    const PLATFORM_WIDTH = 70
    const PLATFORM_HEIGHT = 15
    const PLATFORM_COUNT = 7

    useEffect(() => {
        const saved = localStorage.getItem('somniaJumpHighScore')
        if (saved) setHighScore(parseInt(saved))

        // Load leaderboard
        fetchLeaderboard()
    }, [])

    const fetchLeaderboard = async () => {
        try {
            const res = await fetch('/api/leaderboard')
            const data = await res.json()
            setLeaderboard(data.leaderboard || [])
        } catch (error) {
            console.error('Failed to fetch leaderboard:', error)
        }
    }

    const saveToLeaderboard = async (playerScore: number) => {
        if (!address || savingToLeaderboard) return

        setSavingToLeaderboard(true)
        try {
            await fetch('/api/leaderboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, score: playerScore })
            })
            await fetchLeaderboard()
        } catch (error) {
            console.error('Failed to save to leaderboard:', error)
        }
        setSavingToLeaderboard(false)
    }

    const generatePlatforms = useCallback((startY: number, count: number): Platform[] => {
        const platforms: Platform[] = []
        for (let i = 0; i < count; i++) {
            platforms.push({
                x: Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH),
                y: startY - i * (CANVAS_HEIGHT / PLATFORM_COUNT),
                width: PLATFORM_WIDTH
            })
        }
        return platforms
    }, [])

    const startGame = useCallback(() => {
        const game = gameRef.current

        // Reset player - start on first platform
        game.player = {
            x: CANVAS_WIDTH / 2 - 30,
            y: CANVAS_HEIGHT - 100,
            vy: JUMP_VELOCITY,
            width: 60,
            height: 60
        }

        // Generate initial platforms
        game.platforms = []
        // First platform directly under player
        game.platforms.push({
            x: CANVAS_WIDTH / 2 - PLATFORM_WIDTH / 2,
            y: CANVAS_HEIGHT - 50,
            width: PLATFORM_WIDTH
        })
        // Rest of platforms going up
        game.platforms.push(...generatePlatforms(CANVAS_HEIGHT - 150, PLATFORM_COUNT - 1))

        game.maxY = 0
        game.keys = { left: false, right: false }

        setScore(0)
        setGameState('playing')
        setSavedToChain(false)
    }, [generatePlatforms])

    const togglePause = useCallback(() => {
        setGameState(prev => prev === 'playing' ? 'paused' : prev === 'paused' ? 'playing' : prev)
    }, [])

    const goToMenu = useCallback(() => {
        cancelAnimationFrame(gameRef.current.animationId)
        setGameState('start')
        setScore(0)
    }, [])

    // Save score to blockchain
    const saveToBlockchain = useCallback(() => {
        if (!isConnected || !address) return

        // Create a message with the score data
        const scoreData = JSON.stringify({
            game: 'SomniaJump',
            player: address,
            score: score,
            timestamp: Date.now()
        })

        // Send transaction with score in data field
        sendTransaction({
            to: address, // Send to self (or could be a contract address)
            value: parseEther('0'), // No value, just data
            data: toHex(scoreData),
            gas: BigInt(50000) // Explicit gas limit for data transaction
        })

        setSavedToChain(true)
    }, [isConnected, address, score, sendTransaction])

    useEffect(() => {
        if (gameState !== 'playing') return

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const game = gameRef.current

        const gameLoop = () => {
            const player = game.player
            const platforms = game.platforms

            // Horizontal movement
            if (game.keys.left) player.x -= MOVE_SPEED
            if (game.keys.right) player.x += MOVE_SPEED

            // Screen wrap
            if (player.x < -player.width) player.x = CANVAS_WIDTH
            if (player.x > CANVAS_WIDTH) player.x = -player.width

            // Apply gravity
            player.vy += GRAVITY
            player.y += player.vy

            // Platform collision (only when falling)
            if (player.vy > 0) {
                for (const platform of platforms) {
                    if (
                        player.x + player.width > platform.x &&
                        player.x < platform.x + platform.width &&
                        player.y + player.height >= platform.y &&
                        player.y + player.height <= platform.y + PLATFORM_HEIGHT + player.vy
                    ) {
                        player.y = platform.y - player.height
                        player.vy = JUMP_VELOCITY
                        break
                    }
                }
            }

            // Scroll world when player goes above middle
            if (player.y < CANVAS_HEIGHT / 2) {
                const scrollAmount = CANVAS_HEIGHT / 2 - player.y
                player.y = CANVAS_HEIGHT / 2
                game.maxY += scrollAmount

                // Move all platforms down
                for (const platform of platforms) {
                    platform.y += scrollAmount
                }

                // Remove platforms below screen and add new ones above
                game.platforms = platforms.filter(p => p.y < CANVAS_HEIGHT + 50)

                while (game.platforms.length < PLATFORM_COUNT) {
                    const topPlatform = game.platforms.reduce((min, p) => p.y < min.y ? p : min, game.platforms[0])
                    game.platforms.push({
                        x: Math.random() * (CANVAS_WIDTH - PLATFORM_WIDTH),
                        y: topPlatform.y - (CANVAS_HEIGHT / PLATFORM_COUNT),
                        width: PLATFORM_WIDTH
                    })
                }

                // Update score
                const newScore = Math.floor(game.maxY / 10)
                setScore(newScore)
            }

            // Game over - fell off screen
            if (player.y > CANVAS_HEIGHT) {
                const finalScore = Math.floor(game.maxY / 10)
                if (finalScore > highScore) {
                    setHighScore(finalScore)
                    localStorage.setItem('somniaJumpHighScore', finalScore.toString())
                }
                setGameState('gameover')
                // Auto-save to leaderboard if connected
                if (address && finalScore > 0) {
                    saveToLeaderboard(finalScore)
                }
                return
            }

            // ===== RENDER =====
            // Background
            ctx.fillStyle = '#0a0a1a'
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

            // Stars
            ctx.fillStyle = 'rgba(255,255,255,0.5)'
            for (let i = 0; i < 30; i++) {
                const sx = (i * 47 + game.maxY * 0.02) % CANVAS_WIDTH
                const sy = (i * 89) % CANVAS_HEIGHT
                ctx.fillRect(sx, sy, 2, 2)
            }

            // Platforms
            for (const platform of game.platforms) {
                const gradient = ctx.createLinearGradient(platform.x, platform.y, platform.x, platform.y + PLATFORM_HEIGHT)
                gradient.addColorStop(0, '#7B3FF2')
                gradient.addColorStop(1, '#5B2FC2')
                ctx.fillStyle = gradient
                ctx.beginPath()
                ctx.roundRect(platform.x, platform.y, platform.width, PLATFORM_HEIGHT, 5)
                ctx.fill()
            }

            // Player - Cypher Character
            const px = player.x + player.width / 2
            const py = player.y + player.height / 2
            const scale = player.width / 40 // Scale based on player size

            ctx.save()
            ctx.translate(px, py)
            ctx.scale(scale, scale)

            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)'
            ctx.beginPath()
            ctx.ellipse(0, 18, 12, 2, 0, 0, Math.PI * 2)
            ctx.fill()

            // Body gradient
            const bodyGrad = ctx.createLinearGradient(-15, -20, 15, 20)
            bodyGrad.addColorStop(0, '#8b5cf6')
            bodyGrad.addColorStop(1, '#3b82f6')

            // Body shape (translated from SVG path)
            ctx.fillStyle = bodyGrad
            ctx.beginPath()
            ctx.moveTo(-8, -6) // Start point (scaled from 30,30 -> center)
            ctx.quadraticCurveTo(-8, -14, 0, -14) // Top left curve
            ctx.quadraticCurveTo(8, -14, 8, -6) // Top right curve
            ctx.lineTo(10, 14) // Right side
            ctx.quadraticCurveTo(10, 20, 0, 20) // Bottom right curve
            ctx.quadraticCurveTo(-10, 20, -10, 14) // Bottom left curve
            ctx.closePath()
            ctx.fill()

            // Eye visor
            ctx.fillStyle = '#1e1b4b'
            ctx.beginPath()
            ctx.roundRect(-6, -4, 12, 5, 2.5)
            ctx.fill()

            // Glowing eyes with animation
            const eyeGlow = 0.5 + 0.5 * Math.sin(Date.now() / 500)
            ctx.shadowColor = '#60a5fa'
            ctx.shadowBlur = 8 * eyeGlow

            ctx.fillStyle = '#60a5fa'
            ctx.beginPath()
            ctx.arc(-3, -1.5, 1.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(3, -1.5, 1.5, 0, Math.PI * 2)
            ctx.fill()

            ctx.shadowBlur = 0

            // Core ring
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.arc(0, 10, 4, 0, Math.PI * 2)
            ctx.stroke()

            // Core center with glow
            ctx.shadowColor = '#a78bfa'
            ctx.shadowBlur = 6
            ctx.fillStyle = '#a78bfa'
            ctx.beginPath()
            ctx.arc(0, 10, 2, 0, Math.PI * 2)
            ctx.fill()

            ctx.shadowBlur = 0
            ctx.restore()

            game.animationId = requestAnimationFrame(gameLoop)
        }

        game.animationId = requestAnimationFrame(gameLoop)

        return () => cancelAnimationFrame(game.animationId)
    }, [gameState, highScore])

    // Keyboard controls
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') gameRef.current.keys.left = true
            if (e.key === 'ArrowRight' || e.key === 'd') gameRef.current.keys.right = true
            if (e.key === ' ' && gameState === 'gameover') startGame()
            if (e.key === 'Escape' && (gameState === 'playing' || gameState === 'paused')) togglePause()
        }
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'a') gameRef.current.keys.left = false
            if (e.key === 'ArrowRight' || e.key === 'd') gameRef.current.keys.right = false
        }

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [gameState, startGame, togglePause])

    // Touch controls
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const onTouchStart = (e: TouchEvent) => {
            const touch = e.touches[0]
            const rect = canvas.getBoundingClientRect()
            const x = touch.clientX - rect.left
            if (x < CANVAS_WIDTH / 2) {
                gameRef.current.keys.left = true
            } else {
                gameRef.current.keys.right = true
            }
        }
        const onTouchEnd = () => {
            gameRef.current.keys.left = false
            gameRef.current.keys.right = false
        }

        canvas.addEventListener('touchstart', onTouchStart)
        canvas.addEventListener('touchend', onTouchEnd)
        return () => {
            canvas.removeEventListener('touchstart', onTouchStart)
            canvas.removeEventListener('touchend', onTouchEnd)
        }
    }, [])

    return (
        <div className="game-container">
            <div className="game-header">
                <h1 className="game-title">Somnia <span className="gradient-text">Jump</span></h1>
                {gameState === 'playing' && (
                    <button className="pause-button" onClick={togglePause} title="Pause (Esc)">⏸</button>
                )}
                <div className="score-display">
                    <div className="score-item">
                        <span className="score-label">Score</span>
                        <span className="score-value">{score}</span>
                    </div>
                    <div className="score-item">
                        <span className="score-label">Best</span>
                        <span className="score-value">{highScore}</span>
                    </div>
                </div>
            </div>

            <div className="canvas-wrapper">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="game-canvas"
                />

                {gameState === 'start' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <div className="character-preview">
                                <svg viewBox="0 0 100 100" className="cypher-float">
                                    {/* Shadow */}
                                    <ellipse cx="50" cy="90" rx="20" ry="4" fill="rgba(0,0,0,0.3)" />

                                    {/* Gradient definitions */}
                                    <defs>
                                        <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#8b5cf6" />
                                            <stop offset="100%" stopColor="#3b82f6" />
                                        </linearGradient>
                                        <filter id="glow">
                                            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                            <feMerge>
                                                <feMergeNode in="coloredBlur" />
                                                <feMergeNode in="SourceGraphic" />
                                            </feMerge>
                                        </filter>
                                    </defs>

                                    {/* Body Shape */}
                                    <path d="M35 35 Q35 20 50 20 Q65 20 65 35 L70 70 Q70 82 50 82 Q30 82 30 70 Z" fill="url(#bodyGradient)" />

                                    {/* Eye Visor */}
                                    <rect x="38" y="38" width="24" height="10" rx="5" fill="#1e1b4b" />

                                    {/* Glowing Eyes */}
                                    <circle cx="44" cy="43" r="3" fill="#60a5fa" filter="url(#glow)">
                                        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
                                    </circle>
                                    <circle cx="56" cy="43" r="3" fill="#60a5fa" filter="url(#glow)">
                                        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
                                    </circle>

                                    {/* Core Ring */}
                                    <circle cx="50" cy="65" r="8" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />

                                    {/* Core Center */}
                                    <circle cx="50" cy="65" r="4" fill="#a78bfa" filter="url(#glow)">
                                        <animate attributeName="r" values="4;5;4" dur="1.5s" repeatCount="indefinite" />
                                    </circle>
                                </svg>
                            </div>
                            <h2 className="overlay-title">Somnia Jump</h2>
                            <p className="overlay-description">Help Cypher reach the stars!</p>
                            {highScore > 0 && (
                                <div className="best-score-badge">
                                    🏆 Best: {highScore}
                                </div>
                            )}
                            <div className="controls-info">
                                <p>🎮 ← → or A/D to move</p>
                                <p>📱 Touch left/right on mobile</p>
                                <p>⏸ ESC to pause</p>
                            </div>
                            <div className="menu-buttons">
                                <button className="game-button" onClick={startGame}>🚀 Start Game</button>
                                <button className="game-button secondary" onClick={() => setShowLeaderboard(!showLeaderboard)}>
                                    🏆 Leaderboard
                                </button>
                            </div>

                            {showLeaderboard && (
                                <div className="leaderboard">
                                    <h3 className="leaderboard-title">🏆 Top Players</h3>
                                    {leaderboard.length === 0 ? (
                                        <p className="leaderboard-empty">No scores yet. Be the first!</p>
                                    ) : (
                                        <div className="leaderboard-list">
                                            {leaderboard.map((entry, index) => (
                                                <div key={index} className={`leaderboard-entry ${address?.toLowerCase() === entry.address.toLowerCase() ? 'is-you' : ''}`}>
                                                    <span className="leaderboard-rank">
                                                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                                                    </span>
                                                    <span className="leaderboard-address">
                                                        {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                                                    </span>
                                                    <span className="leaderboard-score">{entry.score}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {gameState === 'paused' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <h2 className="overlay-title">⏸ Paused</h2>
                            <p className="overlay-description">Score: {score}</p>
                            <div className="pause-buttons">
                                <button className="game-button" onClick={togglePause}>▶ Resume</button>
                                <button className="game-button secondary" onClick={goToMenu}>🏠 Main Menu</button>
                            </div>
                            <p className="hint">Press ESC to resume</p>
                        </div>
                    </div>
                )}

                {gameState === 'gameover' && (
                    <div className="game-overlay">
                        <div className="overlay-content">
                            <h2 className="overlay-title">Game Over!</h2>
                            <div className="final-score">
                                <p className="score-label">Score</p>
                                <p className="score-value-large">{score}</p>
                            </div>
                            {score >= highScore && score > 0 && <p className="new-record">🎉 New Record!</p>}

                            {/* Blockchain save section */}
                            {isConnected ? (
                                <div className="blockchain-section">
                                    {!savedToChain && !txHash && (
                                        <button
                                            className="game-button blockchain-button"
                                            onClick={saveToBlockchain}
                                            disabled={isSending}
                                        >
                                            {isSending ? '⏳ Sending...' : '⛓️ Save to Blockchain'}
                                        </button>
                                    )}
                                    {txHash && isConfirming && (
                                        <p className="tx-status confirming">⏳ Confirming transaction...</p>
                                    )}
                                    {txHash && isConfirmed && (
                                        <p className="tx-status confirmed">✅ Score saved on-chain!</p>
                                    )}
                                    {sendError && (
                                        <p className="tx-status error">❌ Transaction failed</p>
                                    )}
                                </div>
                            ) : (
                                <div className="connect-prompt">
                                    <p className="hint">Connect wallet to save on-chain</p>
                                    <ConnectButton />
                                </div>
                            )}

                            <div className="gameover-buttons">
                                <button className="game-button" onClick={startGame}>🔄 Play Again</button>
                                <button className="game-button secondary" onClick={goToMenu}>🏠 Main Menu</button>
                            </div>
                            <p className="hint">Press SPACE to restart</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="game-footer">
                <p>Built with ❤️ on Somnia Network</p>
            </div>
        </div>
    )
}
