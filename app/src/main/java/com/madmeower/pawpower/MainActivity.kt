package com.madmeower.pawpower

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.provider.Settings
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.ViewModelProvider
import androidx.compose.runtime.DisposableEffect
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.messaging.FirebaseMessaging
import com.madmeower.pawpower.ui.theme.PawPowerTheme

class MainActivity : ComponentActivity() {
    private val monitoringModel by lazy { ViewModelProvider(this)[MonitoringViewModel::class.java] }
    private val pawBallModel by lazy { ViewModelProvider(this)[PawBallViewModel::class.java] }
    private val historyModel by lazy { ViewModelProvider(this)[HistoryViewModel::class.java] }
    private val unitLogsModel by lazy { ViewModelProvider(this)[UnitLogsViewModel::class.java] }
    private val equipmentModel by lazy { ViewModelProvider(this)[EquipmentPreferencesViewModel::class.java] }
    private val batterySettingsModel by lazy { ViewModelProvider(this)[BatterySettingsViewModel::class.java] }
    private val preferencesModel by lazy { ViewModelProvider(this)[NotificationPreferencesViewModel::class.java] }
    private var token by mutableStateOf<String?>(null)
    private var status by mutableStateOf("Checking Firebase…")
    private var showRationale by mutableStateOf(false)
    private var showSettings by mutableStateOf(false)
    private var refreshCount by mutableStateOf(0)
    private var appTokenInput by mutableStateOf("")
    private var registrationStatus by mutableStateOf("Enter your server app token to register this phone.")
    private var savingToken by mutableStateOf(false)
    private var latestRegistrationId: java.util.UUID? = null
    private var hasSavedToken by mutableStateOf(false)

    // Activity 1.8's lint assumes FragmentActivity; this app extends ComponentActivity and uses no fragments.
    @android.annotation.SuppressLint("InvalidFragmentVersionForActivityResult")
    private val permissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        refreshCount++
        if (!granted && Build.VERSION.SDK_INT >= 33 &&
            !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
        ) showSettings = true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        )
        registerIfConfigured()
        PawPowerNotifications.createChannel(this)
        fetchToken()
        setContent {
            PawPowerTheme {
                var showSetup by rememberSaveable { mutableStateOf(false) }
                var showBatterySettings by rememberSaveable { mutableStateOf(false) }
                var showPreferences by rememberSaveable { mutableStateOf(false) }
                var showHistory by rememberSaveable { mutableStateOf(false) }
                var showGame by rememberSaveable { mutableStateOf(false) }
                var showLogs by rememberSaveable { mutableStateOf(false) }
                val backState = rememberNavigationEventState(currentInfo = NavigationEventInfo.None)
                NavigationBackHandler(
                    state = backState,
                    isBackEnabled = showSetup || showPreferences || showHistory || showGame || showBatterySettings || showLogs,
                    onBackCompleted = {
                        when {
                            showSetup -> showSetup = false
                            showBatterySettings -> showBatterySettings = false
                            showLogs -> showLogs = false
                            showGame -> showGame = false
                            showHistory -> showHistory = false
                            showPreferences -> showPreferences = false
                        }
                    }
                )
                DisposableEffect(showSetup) {
                    if (showSetup) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    onDispose { }
                }
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    // Re-evaluate notification settings after returning from Android Settings.
                    @Suppress("UNUSED_VARIABLE") val refresh = refreshCount
                    if (showSetup) Column(
                        modifier = Modifier.padding(innerPadding).consumeWindowInsets(innerPadding)
                            .fillMaxSize().imePadding()
                            .verticalScroll(rememberScrollState()).padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text("PawPower", style = MaterialTheme.typography.headlineLarge)
                        TextButton(onClick = { showSetup = false }) { Text(if (showPreferences) "Back to preferences" else "Back to monitoring") }
                        Text("Notification setup", style = MaterialTheme.typography.titleLarge)
                        Text(status)
                        Text(
                            if (PawPowerNotifications.enabled(this@MainActivity))
                                "Notifications are enabled."
                            else "Notifications are off. Enable them to receive battery alerts."
                        )
                        Button(onClick = { enableNotifications() }) {
                            Text("Enable notifications")
                        }
                        Button(onClick = {
                            status = if (PawPowerNotifications.show(
                                    this@MainActivity, "PawPower local test",
                                    "Notifications work on this phone. This is not a cloud push."
                                )) "Local notification posted. Check the notification shade."
                                else "Notifications are blocked. Enable them in Android Settings."
                        }) { Text("Test local notification") }
                        Button(onClick = { fetchToken() }) { Text("Refresh Firebase status") }
                        token?.let { currentToken ->
                            Text("FCM token ready", style = MaterialTheme.typography.titleMedium)
                            Text("For a Firebase Console test, use this token. Keep it private.")
                            SelectionContainer { Text(currentToken) }
                        }
                        Text("Connect this phone", style = MaterialTheme.typography.titleLarge)
                        Text(if (hasSavedToken) "Your app token is saved securely. You only need to enter it below if it changes."
                            else "Enter app_token from your private server configuration. Do not enter the admin token or a Firebase private key.")
                        OutlinedTextField(
                            value = appTokenInput,
                            onValueChange = { appTokenInput = it },
                            label = { Text("PawPower app token") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                            singleLine = true,
                            enabled = !savingToken
                        )
                        Button(onClick = { saveAndRegister() }, enabled = !savingToken && appTokenInput.isNotBlank()) {
                            Text(if (savingToken) "Saving…" else "Save token and register phone")
                        }
                        Button(onClick = { registerIfConfigured() }, enabled = !savingToken) {
                            Text("Retry phone registration")
                        }
                        Text(registrationStatus)
                        Text("Registration does not change server push settings.")
                    } else if (showBatterySettings) {
                        BatterySettingsScreen(batterySettingsModel, Modifier.padding(innerPadding).consumeWindowInsets(innerPadding),
                            onBack = { showBatterySettings = false })
                    } else if (showLogs) {
                        UnitLogsScreen(unitLogsModel, Modifier.padding(innerPadding), onBack = { showLogs = false })
                    } else if (showGame) {
                        PawBallScreen(pawBallModel, Modifier.padding(innerPadding), onBack = { showGame = false })
                    } else if (showHistory) {
                        HistoryScreen(historyModel, Modifier.padding(innerPadding), onBack = { showHistory = false })
                    } else if (showPreferences) {
                        NotificationPreferencesScreen(preferencesModel,
                            Modifier.padding(innerPadding).consumeWindowInsets(innerPadding), equipmentModel = equipmentModel,
                            onBack = { showPreferences = false },
                            onSetup = { showSetup = true })
                    } else {
                        MonitoringScreen(monitoringModel, historyModel, Modifier.padding(innerPadding),
                            onOpenSetup = { showPreferences = true }, onOpenHistory = { showHistory = true },
                            onOpenGame = { showGame = true }, onOpenBatterySettings = { showBatterySettings = true },
                            onOpenLogs = { solar -> unitLogsModel.select(if(solar) "tracer" else "pawpower",unitLogsModel.date); showLogs = true })
                    }
                    if (showRationale) {
                        AlertDialog(
                            onDismissRequest = { showRationale = false },
                            title = { Text("Allow battery alerts") },
                            text = { Text("PawPower needs notification permission to show temperature alerts and test messages.") },
                            confirmButton = {
                                TextButton(onClick = {
                                    showRationale = false
                                    if (Build.VERSION.SDK_INT >= 33) {
                                        permissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
                                    }
                                }) { Text("Continue") }
                            },
                            dismissButton = {
                                TextButton(onClick = { showRationale = false }) { Text("Cancel") }
                            }
                        )
                    }
                    if (showSettings) {
                        AlertDialog(
                            onDismissRequest = { showSettings = false },
                            title = { Text("Notification settings") },
                            text = { Text("You can enable PawPower notifications in Android Settings.") },
                            confirmButton = {
                                TextButton(onClick = {
                                    showSettings = false
                                    openSettings()
                                }) { Text("Open settings") }
                            },
                            dismissButton = {
                                TextButton(onClick = { showSettings = false }) { Text("Cancel") }
                            }
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refreshCount++
    }

    private fun fetchToken() {
        status = "Connecting to Firebase…"
        FirebaseMessaging.getInstance().token.addOnCompleteListener(this) { task ->
            if (task.isSuccessful) {
                token = task.result
                status = "Firebase connected."
            } else {
                status = "Could not get an FCM token. Check internet and Google Play services, then retry."
            }
        }
    }

    private fun saveAndRegister() {
        val candidate = appTokenInput.trim()
        if (!PhoneCredentials.validToken(candidate)) {
            registrationStatus = "App tokens contain 32–256 letters, numbers, underscores or hyphens."
            return
        }
        savingToken = true
        lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) {
                runCatching { PhoneCredentials.save(applicationContext, candidate) }.isSuccess
            }
            savingToken = false
            if (saved) {
                hasSavedToken = true
                appTokenInput = ""
                observeRegistration(PhoneRegistrationWorker.enqueue(applicationContext))
            } else {
                registrationStatus = "Could not securely save the app token. Please try again."
            }
        }
    }

    private fun registerIfConfigured() {
        lifecycleScope.launch {
            val configured = withContext(Dispatchers.IO) {
                runCatching { PhoneCredentials.read(applicationContext) != null }
            }
            hasSavedToken = configured.getOrNull() == true
            if (hasSavedToken) {
                observeRegistration(PhoneRegistrationWorker.enqueue(applicationContext))
            } else {
                registrationStatus = if (configured.isFailure)
                    "Saved credentials could not be read. Enter your app token again."
                else "Enter your server app token to register this phone."
            }
        }
    }

    private fun observeRegistration(id: java.util.UUID) {
        latestRegistrationId = id
        WorkManager.getInstance(this).getWorkInfoByIdLiveData(id).observe(this) { work ->
            if (work == null || id != latestRegistrationId) return@observe
            registrationStatus = when (work.state) {
                WorkInfo.State.SUCCEEDED, WorkInfo.State.FAILED ->
                    work.outputData.getString(PhoneRegistrationWorker.MESSAGE)
                        ?: "Registration ended. Tap retry to try again."
                WorkInfo.State.RUNNING -> "Registering this phone with PawPower…"
                WorkInfo.State.CANCELLED -> "Registration cancelled. Tap retry."
                else -> "Registration queued. Waiting for internet or a retry after a temporary failure."
            }
        }
    }

    private fun enableNotifications() {
        if (PawPowerNotifications.enabled(this)) {
            status = "Notifications are already enabled."
        } else if (Build.VERSION.SDK_INT < 33) {
            openSettings()
        } else if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            showRationale = true
        } else {
            permissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun openSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        })
    }
}
