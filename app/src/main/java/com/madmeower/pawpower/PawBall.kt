package com.madmeower.pawpower

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import kotlin.math.*

data class PawBallState(
    val player: Double = 160.0, val donut: Double = 160.0,
    val x: Double = 320.0, val y: Double = 160.0,
    val vx: Double = -240.0, val vy: Double = 95.0,
    val you: Int = 0, val donutScore: Int = 0, val wait: Double = 0.6, val winner: String = ""
)

/** Port of the shared webpage game: same court, Donut speed, bounce angles and first-to-seven rules. */
fun stepPawBall(state: PawBallState, seconds: Double, target: Double, sound: (String) -> Unit = {}): PawBallState {
    if (state.winner.isNotEmpty()) return state
    val dt = seconds.coerceIn(0.0, 0.025)
    var s = state.copy(
        player = (state.player + (target - state.player).coerceIn(-360 * dt, 360 * dt)).coerceIn(34.0, 286.0),
        donut = (state.donut + ((if (state.vx > 0) state.y else 160.0) - state.donut)
            .coerceIn(-190 * dt, 190 * dt)).coerceIn(34.0, 286.0))
    if (s.wait > 0) return s.copy(wait = max(0.0, s.wait - dt))
    s = s.copy(x = s.x + s.vx * dt, y = s.y + s.vy * dt)
    if (s.y < 7) { s = s.copy(y = 14 - s.y, vy = abs(s.vy)); sound("wall") }
    if (s.y > 313) { s = s.copy(y = 626 - s.y, vy = -abs(s.vy)); sound("wall") }
    fun hit(center: Double, direction: Int) {
        val angle = ((s.y - center) / 34).coerceIn(-1.0, 1.0) * 1.05
        val speed = min(430.0, hypot(s.vx, s.vy) + 18)
        s = s.copy(vx = direction * speed * cos(angle), vy = speed * sin(angle)); sound("hit")
    }
    if (s.vx < 0 && s.x <= 37 && s.x >= 20 && abs(s.y - s.player) <= 39) {
        s = s.copy(x = 37.0); hit(s.player, 1)
    }
    if (s.vx > 0 && s.x >= 603 && s.x <= 620 && abs(s.y - s.donut) <= 39) {
        s = s.copy(x = 603.0); hit(s.donut, -1)
    }
    if (s.x < -7 || s.x > 647) {
        val point = s.x > 647
        val you = s.you + if (point) 1 else 0
        val donut = s.donutScore + if (point) 0 else 1
        s = s.copy(you = you, donutScore = donut,
            winner = when { you >= 7 -> "You win!"; donut >= 7 -> "Donut wins!"; else -> "" },
            x = 320.0, y = 160.0, vx = if (point) 240.0 else -240.0,
            vy = if ((you + donut) % 2 != 0) 95.0 else -95.0, wait = 0.7)
        sound(if (donut >= 7) "meow" else if (point) "point" else "miss")
    }
    return s
}

class PawBallViewModel : ViewModel() {
    var state by mutableStateOf(PawBallState())
        private set
    var running by mutableStateOf(false)
    var started by mutableStateOf(false)
        private set
    var sound by mutableStateOf(true)
    var speed by mutableStateOf(1.5f)
        private set
    fun setGameSpeed(value: Float) { if (value.isFinite()) speed = value.coerceIn(1f, 3f) }
    var target by mutableStateOf(160.0)
    fun reset() { state = PawBallState(); target = 160.0; running = false; started = false }
    fun toggle() {
        if (state.winner.isNotEmpty()) reset()
        running = !running
        if (running) started = true
    }
    fun advance(seconds: Double, audio: (String) -> Unit) {
        if (!running) return
        // Scale the whole game, retaining small steps so fast balls cannot skip paddles.
        val elapsed = seconds.coerceIn(0.0, 0.05) * speed
        val steps = max(1, ceil(elapsed / 0.008).toInt())
        var next = state
        repeat(steps) { next = stepPawBall(next, elapsed / steps, target) { if (sound) audio(it) } }
        state = next
        if (next.winner.isNotEmpty()) running = false
    }
}
