import CoreBluetooth
import React

@objc(BLEPeripheralModule)
class BLEPeripheralModule: RCTEventEmitter, CBPeripheralManagerDelegate {
  
  var peripheralManager: CBPeripheralManager?
  var isAdvertising = false
  var pendingLocalName: String?
  
  override func supportedEvents() -> [String]! {
    return ["onBLEStateChange"]
  }
  
  @objc func startAdvertising(_ localName: String) {
    pendingLocalName = localName
    if peripheralManager == nil {
      peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    } else if peripheralManager?.state == .poweredOn {
      beginAdvertising(localName)
    }
  }
  
  func beginAdvertising(_ localName: String) {
    guard let manager = peripheralManager, manager.state == .poweredOn else { return }
    if isAdvertising { manager.stopAdvertising() }
    
    let serviceUUID = CBUUID(string: "12345678-1234-1234-1234-123456789ABC")
    let advertisementData: [String: Any] = [
      CBAdvertisementDataLocalNameKey: localName,
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID]
    ]
    manager.startAdvertising(advertisementData)
    isAdvertising = true
    print("BLE 광고 시작: \(localName)")
  }
  
  @objc func stopAdvertising() {
    peripheralManager?.stopAdvertising()
    isAdvertising = false
    print("BLE 광고 중지")
  }
  
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    switch peripheral.state {
    case .poweredOn:
      print("BLE PoweredOn")
      if let name = pendingLocalName {
        beginAdvertising(name)
      }
    case .poweredOff:
      print("BLE PoweredOff")
    default:
      break
    }
  }
  
  override static func requiresMainQueueSetup() -> Bool { return false }
}
