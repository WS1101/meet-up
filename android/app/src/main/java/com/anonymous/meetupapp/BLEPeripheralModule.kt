package com.anonymous.meetupapp

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

class BLEPeripheralModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BLEPeripheralModule"

    private var advertiser: BluetoothLeAdvertiser? = null
    private var advertiseCallback: AdvertiseCallback? = null
    private val SERVICE_UUID = UUID.fromString("12345678-1234-1234-1234-123456789abc")

    @ReactMethod
    fun startAdvertising(localName: String, promise: Promise) {
        try {
            val bluetoothManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            adapter.name = localName
            advertiser = adapter.bluetoothLeAdvertiser

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(false)
                .build()

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()

            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    println("BLE 광고 시작: $localName")
                    promise.resolve(true)
                }
                override fun onStartFailure(errorCode: Int) {
                    promise.reject("BLE_ERROR", "광고 시작 실패: $errorCode")
                }
            }

            advertiser?.startAdvertising(settings, data, advertiseCallback)
        } catch (e: Exception) {
            promise.reject("BLE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        advertiseCallback?.let { advertiser?.stopAdvertising(it) }
        promise.resolve(true)
    }
}
