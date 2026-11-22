package com.madmeower.pawpower

import android.content.Context
import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PhoneCredentialsTest {
    private fun isolatedContext(): Pair<Context, File> {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(target.cacheDir, "credential-test-" + UUID.randomUUID()).apply { mkdirs() }
        return object : ContextWrapper(target) {
            override fun getNoBackupFilesDir(): File = directory
        } to directory
    }

    @Test
    fun credentialsAreEncryptedAndTokenRotationPreservesInstallation() {
        val (context, directory) = isolatedContext()
        try {
            assertNull(PhoneCredentials.read(context))
            val firstToken = "A".repeat(64)
            PhoneCredentials.save(context, firstToken)
            val first = requireNotNull(PhoneCredentials.read(context))
            assertEquals(firstToken, first.appToken)
            assertTrue(first.installationId.matches(Regex("[a-zA-Z0-9_-]{16,100}")))
            assertFalse(File(directory, "phone-credentials.enc").readBytes()
                .toString(Charsets.ISO_8859_1).contains(firstToken))

            val nextToken = "B".repeat(64)
            PhoneCredentials.save(context, nextToken)
            val second = requireNotNull(PhoneCredentials.read(context))
            assertEquals(nextToken, second.appToken)
            assertEquals(first.installationId, second.installationId)
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun tamperedCiphertextIsRejected() {
        val (context, directory) = isolatedContext()
        try {
            PhoneCredentials.save(context, "C".repeat(64))
            val file = File(directory, "phone-credentials.enc")
            val bytes = file.readBytes()
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            file.writeBytes(bytes)
            assertTrue(runCatching { PhoneCredentials.read(context) }.isFailure)
        } finally {
            directory.deleteRecursively()
        }
    }
}
