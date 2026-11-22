package com.madmeower.pawpower

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Phone-only credentials: encrypted by Android Keystore and excluded from backup. */
object PhoneCredentials {
    private const val KEY_ALIAS = "pawpower.phone.credentials.v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private val tokenFormat = Regex("[A-Za-z0-9_-]{32,256}")

    class Credentials(val appToken: String, val installationId: String)

    fun validToken(value: String): Boolean = tokenFormat.matches(value)

    @Synchronized
    fun read(context: Context): Credentials? {
        val file = credentialFile(context)
        val bytes = try {
            file.readFully()
        } catch (_: java.io.FileNotFoundException) {
            return null
        }
        require(bytes.size > 12) { "Invalid credential storage" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        val json = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        return Credentials(json.getString("app_token"), json.getString("installation_id"))
    }

    @Synchronized
    fun save(context: Context, token: String) {
        require(validToken(token))
        val installationId = runCatching { read(context)?.installationId }.getOrNull()
            ?: UUID.randomUUID().toString()
        val plaintext = JSONObject().put("app_token", token)
            .put("installation_id", installationId).toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(plaintext)
        val file = credentialFile(context)
        val output = file.startWrite()
        try {
            output.write(encrypted)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            throw error
        }
    }

    private fun credentialFile(context: Context) =
        AtomicFile(File(context.noBackupFilesDir, "phone-credentials.enc"))

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build()
            )
        }.generateKey()
    }
}
