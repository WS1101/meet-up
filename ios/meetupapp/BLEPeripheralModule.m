#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BLEPeripheralModule, RCTEventEmitter)
RCT_EXTERN_METHOD(startAdvertising:(NSString *)localName)
RCT_EXTERN_METHOD(stopAdvertising)
@end
