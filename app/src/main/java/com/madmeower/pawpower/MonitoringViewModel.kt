package com.madmeower.pawpower

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import kotlinx.coroutines.CancellationException

/** Keeps the last downloaded snapshot across Activity recreation and setup visits. */
class MonitoringViewModel(application: Application) : AndroidViewModel(application) {
    var snapshot by mutableStateOf<ReadingSnapshot?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var loading by mutableStateOf(false)
        private set

    suspend fun refresh() {
        if (loading) return
        loading = true
        try {
            snapshot = MonitoringData.fetch(getApplication())
            error = null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: MonitoringException) {
            error = failure.message
        } finally {
            loading = false
        }
    }
}
