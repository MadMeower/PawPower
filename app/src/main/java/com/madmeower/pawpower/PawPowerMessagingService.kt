package com.madmeower.pawpower

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PawPowerMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // The worker retrieves the latest token and credentials; neither enters job inputs or logs.
        PhoneRegistrationWorker.enqueue(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (isWidgetPush(message.data)) {
            // Data-only snapshots render locally; never become alert banners or fetch more data.
            if (PawPowerWidget.hasWidgets(this)) runCatching {
                val credentials = PhoneCredentials.read(this) ?: return
                val sample = parseWidgetPush(message.data, credentials.installationId, System.currentTimeMillis())
                    ?: return
                if (PawWidgetStore.savePush(this, sample)) PawPowerWidget.updateAll(this)
            }
            return
        }
        // Background notification payloads are displayed by FCM. This handles foreground delivery.
        PawPowerNotifications.show(
            this,
            message.notification?.title ?: "PawPower",
            message.notification?.body ?: message.data["message"] ?: "New PawPower alert"
        )
    }
}
