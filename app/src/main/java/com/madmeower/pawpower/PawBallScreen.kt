package com.madmeower.pawpower

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.flow.collectLatest

@Composable
fun PawBallScreen(model: PawBallViewModel, modifier: Modifier = Modifier, onBack: () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val audio = remember { runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 25) }.getOrNull() }
    DisposableEffect(audio) {
        onDispose { model.running = false; runCatching { audio?.stopTone(); audio?.release() } }
    }
    LaunchedEffect(lifecycle, model, audio) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            try {
                snapshotFlow { model.running }.collectLatest { running ->
                    if (!running) return@collectLatest
                    var previous = 0L
                    while (true) withFrameNanos { now ->
                    if (previous != 0L) model.advance((now - previous) / 1_000_000_000.0) { event ->
                        runCatching { audio?.startTone(when (event) {
                            "point" -> ToneGenerator.TONE_PROP_ACK
                            "miss", "meow" -> ToneGenerator.TONE_PROP_NACK
                            else -> ToneGenerator.TONE_PROP_BEEP
                        }, if (event == "meow") 600 else 60) }
                    }
                    previous = now
                    }
                }
            } finally { model.running = false; runCatching { audio?.stopTone() } }
        }
    }
    val s = model.state
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Paw Ball · Donut", style = MaterialTheme.typography.headlineMedium)
        TextButton(onClick = onBack) { Text("Back to monitoring") }
        Text("You ${s.you} · Donut ${s.donutScore}", style = MaterialTheme.typography.titleLarge)
        Text("First to 7. Drag on the court to move your left paddle. Keyboard: ↑ / ↓ or W / S.")
        Box(Modifier.widthIn(max = 960.dp).fillMaxWidth().aspectRatio(2f)
            .clip(RoundedCornerShape(14.dp)).background(Color(0xFF091820))
            .border(1.dp, Color(0xFF38775C), RoundedCornerShape(14.dp))) {
            Canvas(Modifier.fillMaxSize().semantics {
                contentDescription = "Paw Ball court. You control the left paddle. Donut controls the right."
            }.onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown && event.key in listOf(Key.DirectionUp, Key.W, Key.DirectionDown, Key.S)) {
                    model.target = (model.target + if (event.key == Key.DirectionUp || event.key == Key.W) -20 else 20)
                        .coerceIn(34.0, 286.0); true
                } else false
            }.focusable().pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { position -> model.target = (position.y / size.height * 320.0).coerceIn(34.0, 286.0) },
                    onDrag = { change, _ ->
                        change.consume()
                        model.target = (change.position.y / size.height * 320.0).coerceIn(34.0, 286.0)
                    })
            }) {
                val sx = size.width / 640f; val sy = size.height / 320f
                for (y in 12..308 step 16) drawLine(Color(0xFF29434C),
                    Offset(320 * sx, y * sy), Offset(320 * sx, (y + 7) * sy), 2 * sx)
                drawRect(Color(0xFF64E5B0), Offset(20 * sx, (s.player.toFloat() - 34) * sy), Size(10 * sx, 68 * sy))
                drawRect(Color(0xFFF0BA65), Offset(610 * sx, (s.donut.toFloat() - 34) * sy), Size(10 * sx, 68 * sy))
                drawCircle(Color(0xFFF4F7FA), 7 * sx, Offset(s.x.toFloat() * sx, s.y.toFloat() * sy))
            }
            if (!model.running) Text(s.winner.ifEmpty { if (model.started) "Paused" else "Ready to play?" },
                Modifier.align(Alignment.Center).background(Color(0xDD091820)).padding(12.dp),
                color = Color.White, style = MaterialTheme.typography.titleLarge)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = model::toggle) { Text(if (model.running) "Pause" else if (s.winner.isNotEmpty()) "Play again" else "Play") }
            OutlinedButton(onClick = model::reset) { Text("New game") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TextButton(onClick = { model.target = (model.target - 48).coerceAtLeast(34.0) }) { Text("Paddle up") }
            TextButton(onClick = { model.target = (model.target + 48).coerceAtMost(286.0) }) { Text("Paddle down") }
        }
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth()) {
            Text("Game speed: ${"%.1f".format(java.util.Locale.US, model.speed)}×")
            Slider(value = model.speed, onValueChange = model::setGameSpeed,
                valueRange = 1f..3f, steps = 7,
                modifier = Modifier.semantics { contentDescription = "Game speed" })
            Text("1× Relaxed · 2× Fast · 3× Wild", style = MaterialTheme.typography.bodySmall)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Game sound")
            Switch(model.sound, { model.sound = it; if (!it) audio?.stopTone() }, enabled = audio != null)
        }
        Text("A little fun while the batteries charge.", style = MaterialTheme.typography.bodySmall)
    }
}
