package com.madmeower.pawpower

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

const val DONATION_URL = "https://paypal.me/DonutMeow"
fun donationQrMatrix() = QRCodeWriter().encode(DONATION_URL, BarcodeFormat.QR_CODE, 512, 512,
    mapOf(EncodeHintType.MARGIN to 4))
