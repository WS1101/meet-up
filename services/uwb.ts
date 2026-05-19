import { NativeEventEmitter, NativeModules } from 'react-native';
import { subscribeUWBToken, uploadUWBToken } from './session';

const { UWBModule } = NativeModules;
const emitter = new NativeEventEmitter(UWBModule);

export function startUWB(
  sessionToken: string,
  myId: string,
  partnerId: string,
  onDistance?: (distance: number) => void
) {
  emitter.addListener('onUWBToken', async (data) => {
    await uploadUWBToken(sessionToken, myId, data.token);
    console.log('내 UWB 토큰 업로드 완료');
  });

  subscribeUWBToken(sessionToken, partnerId, (data: any) => {
    console.log('상대방 UWB 토큰 수신, connectWithToken 호출');
    UWBModule.connectWithToken(data.token);
  });

  emitter.addListener('onUWBUpdate', (data) => {
    console.log('UWB 거리:', data.distance);
    if (onDistance) onDistance(data.distance);
  });

  UWBModule.startSession();
}

export function stopUWB() {
  UWBModule.stopRanging();
  emitter.removeAllListeners('onUWBUpdate');
  emitter.removeAllListeners('onUWBError');
  emitter.removeAllListeners('onUWBToken');
}