package com.madmeower.pawpower

import android.app.Application

class PawPowerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PawPowerNotifications.createChannel(this)
    }
}
