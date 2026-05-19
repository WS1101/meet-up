#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(UWBModule, RCTEventEmitter)
RCT_EXTERN_METHOD(startSession)
RCT_EXTERN_METHOD(connectWithToken:(NSString *)partnerTokenString)
@end
