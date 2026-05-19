import { BleManager } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';

const { BLEPeripheralModule } = NativeModules;
const manager = new BleManager();
const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';

export async function requestBLEPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(granted).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  return true;
}

// BLE 광고 시작 (네이티브 모듈 사용)
export async function startAdvertising(myId: string): Promise<void> {
  try {
    await BLEPeripheralModule.startAdvertising(`mu${myId === "userA" ? "A" : "B"}`);
    console.log(`BLE 광고 시작: meetup_${myId}`);
  } catch (e) {
    console.log('BLE 광고 실패:', e);
  }
}

export function stopAdvertising() {
  BLEPeripheralModule.stopAdvertising();
}

// BLE 스캔 (라우터)
export function startScanning(
  onDeviceFound: (userId: string, rssi: number) => void
) {
  manager.onStateChange((state) => {
    if (state === 'PoweredOn') {
      manager.startDeviceScan(
        null,
        { allowDuplicates: true },
        (error, device) => {
          if (error) {
            console.log('BLE 스캔 에러:', error.message);
            return;
          }
          if (device?.localName?.startsWith('mu')) {
            const userId = device.localName.replace('mu', 'user');
            const rssi = device.rssi ?? -999;
            console.log(`BLE 감지: ${userId} RSSI: ${rssi}dBm`);
            onDeviceFound(userId, rssi);
          }
        }
      );
    }
  }, true);
}

export function stopScanning() {
  manager.stopDeviceScan();
}

export function rssiToDistance(rssi: number, txPower = -59): number {
  if (rssi === 0) return -1;
  const ratio = rssi / txPower;
  if (ratio < 1.0) return Math.pow(ratio, 10);
  return 0.89976 * Math.pow(ratio, 7.7095) + 0.111;
}
