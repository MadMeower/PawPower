package com.madmeower.pawpower
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Test
class DonationQrTest {
    @Test fun qrDecodesToTheExistingDonationDestination() {
        val m=donationQrMatrix()
        val pixels=IntArray(m.width*m.height) {if(m[it%m.width,it/m.width]) -0x1000000 else -1}
        val decoded=QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(m.width,m.height,pixels))))
        assertEquals("https://paypal.me/DonutMeow",decoded.text)
    }
}
