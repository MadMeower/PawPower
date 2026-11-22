package com.madmeower.pawpower

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.SystemClock
import android.util.Base64
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.math.PI
import kotlin.math.sin

enum class DonutCameo { PEEK, MESSAGE, FULL }

class PawTapCounter {
    private var taps = 0
    private var last = -1L
    fun tap(now: Long): Boolean {
        if (last < 0 || now < last || now - last > 1000) taps = 0
        last = now
        taps++
        if (taps < 5) return false
        taps = 0
        return true
    }
}

fun shouldDonutVisit(soc: Double?, fresh: Boolean, solar: Boolean, lastVisit: Long, now: Long): Boolean =
    fresh && !solar && soc != null && soc.isFinite() && soc == 100.0 &&
        (lastVisit == 0L || now - lastVisit >= 86_400_000L)

@Composable
fun rememberDonutSurprises(soc: Double?, fresh: Boolean, solar: Boolean): DonutSurprises {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state = remember { DonutSurprises() }
    LaunchedEffect(soc, fresh, solar, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val prefs = context.getSharedPreferences("donut_surprises", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            if (state.cameo == null && shouldDonutVisit(soc, fresh, solar,
                    prefs.getLong("last_full_visit", 0), now)) {
                prefs.edit().putLong("last_full_visit", now).apply()
                state.cameo = DonutCameo.FULL
            }
        }
    }
    return state
}

class DonutSurprises {
    var cameo by mutableStateOf<DonutCameo?>(null)
    private val taps = PawTapCounter()
    fun pawTapped() { if (taps.tap(SystemClock.elapsedRealtime())) cameo = DonutCameo.PEEK }
    fun socHeld() { cameo = DonutCameo.MESSAGE }
}

private object DonutPhoto {
    val mutex = Mutex()
    var cached: ImageBitmap? = null
    suspend fun load(context: Context): ImageBitmap? = withContext(Dispatchers.IO) {
        mutex.withLock {
            cached ?: runCatching {
                // Text asset preserves the supplied photo; decode only when a cameo is shown.
                val encoded = context.assets.open("donut_photo.base64").bufferedReader().use { it.readText() }
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                val options = BitmapFactory.Options()
                while (maxOf(bounds.outWidth, bounds.outHeight) / (options.inSampleSize.coerceAtLeast(1) * 2) >= 512)
                    options.inSampleSize = options.inSampleSize.coerceAtLeast(1) * 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
            }.getOrNull().also { cached = it }
        }
    }
}

@Composable
fun DonutOverlay(mode: DonutCameo, modifier: Modifier = Modifier, onDismiss: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val dismiss by rememberUpdatedState(onDismiss)
    val photo by produceState<ImageBitmap?>(null) { value = DonutPhoto.load(context) }
    val travel = remember { Animatable(-160f) }
    var support by rememberSaveable { mutableStateOf(false) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) dismiss()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    BoxWithConstraints(modifier.fillMaxWidth().height(230.dp).clipToBounds()) {
        val width = maxWidth.value
        LaunchedEffect(mode, photo, support) {
            if (support) return@LaunchedEffect
            if (photo == null) return@LaunchedEffect
            if (mode == DonutCameo.PEEK) launch { playDonutMeow(context) }
            if (mode == DonutCameo.FULL) {
                travel.snapTo(-160f)
                travel.animateTo(width, tween(6500, easing = LinearEasing))
            } else delay(4500)
            dismiss()
        }
        // An unavailable asset never leaves a lingering overlay.
        LaunchedEffect(support) { if (!support) { delay(10_000); dismiss() } }
        val position = if (mode == DonutCameo.FULL)
            Modifier.align(Alignment.BottomStart).offset(x = travel.value.dp)
        else Modifier.align(Alignment.BottomEnd).padding(end = 12.dp)
        Surface(position.width(150.dp).clickable(onClickLabel = "Open Donut and donation QR", onClick = { support = true }),
            shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shadowElevation = 6.dp) {
            Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                photo?.let {
                    Image(it, "Donut the cat", Modifier.fillMaxWidth().height(150.dp)
                        .clip(RoundedCornerShape(14.dp)), contentScale = ContentScale.Fit)
                }
                Text(when (mode) {
                    DonutCameo.PEEK -> "Meow! — Donut 🐾"
                    DonutCameo.MESSAGE -> "Donut was here 🐾"
                    DonutCameo.FULL -> "Fully charged.\nDonut approves 🐾"
                }, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    if (support) DonutSupport(photo) { support = false; onDismiss() }
}

@Composable
private fun DonutSupport(photo: ImageBitmap?, onClose: () -> Unit) {
    val uri = LocalUriHandler.current
    val qr by produceState<ImageBitmap?>(null) {
        value = withContext(Dispatchers.Default) {
            val matrix = donationQrMatrix()
            val pixels = IntArray(matrix.width * matrix.height) { i ->
                if (matrix[i % matrix.width, i / matrix.width]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            }
            Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888).asImageBitmap()
        }
    }
    Dialog(onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                TextButton(onClick = onClose, modifier = Modifier.align(Alignment.End)) { Text("Close") }
                Text("Donut 🐾", style = MaterialTheme.typography.headlineLarge)
                photo?.let { Image(it, "Donut the cat", Modifier.fillMaxWidth().heightIn(max = 360.dp), contentScale = ContentScale.Fit) }
                Text("Support Paw Power", style = MaterialTheme.typography.titleLarge)
                qr?.let { Image(it, "Donation QR code for paypal.me/DonutMeow", Modifier.size(240.dp), contentScale = ContentScale.Fit) }
                TextButton(onClick = { uri.openUri(DONATION_URL) }) { Text("paypal.me/DonutMeow") }
            }
        }
    }
}

private suspend fun playDonutMeow(context: Context) = withContext(Dispatchers.Default) {
    val manager = context.getSystemService(AudioManager::class.java)
    if (manager.ringerMode != AudioManager.RINGER_MODE_NORMAL ||
        manager.getStreamVolume(AudioManager.STREAM_MUSIC) == 0) return@withContext
    var track: AudioTrack? = null
    try {
        val rate = 16000
        val samples = ShortArray(8800)
        var phase = 0.0
        samples.indices.forEach { index ->
            val t = index.toDouble() / samples.size
            val pitch = if (t < 0.25) 420 + 800 * t else 620 - 380 * (t - 0.25)
            phase += 2 * PI * pitch / rate
            val envelope = sin(PI * t) * (0.8 + 0.2 * sin(2 * PI * 18 * t))
            val voice = sin(phase) + 0.45 * sin(phase * 2) + 0.2 * sin(phase * 3)
            samples[index] = (voice * envelope * 3200).toInt().toShort()
        }
        val player = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
        track = player
        player.write(samples, 0, samples.size)
        player.play()
        delay(600)
    } catch (cancelled: kotlinx.coroutines.CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // The hidden cameo still works when sound is unavailable.
    } finally {
        runCatching { track?.stop() }
        track?.release()
    }
}
