package com.madmeower.pawpower

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Repaint stale cached values even when the network is unavailable. Android may defer execution. */
class WidgetExpiryWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        PawPowerWidget.updateAll(applicationContext)
        Result.success()
    }
}
