import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { subscribeUWBToken, uploadUWBToken } from './session';

const { UWBModule } = NativeModules;
const emitter = new NativeEventEmitter(UWBModule);

// UWB 스무딩 - 마지막값 유지 + 이동평균
class UWBSmoother {
  private history: number[] = [];
  private maxHistory = 5;
  private lastValue: number | null = null;
  private lastUpdateTime = 0;
  private staleTimeout = 3000; // 2초 안 오면 stale

  push(value: number): number {
    this.history.push(value);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.lastValue = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    this.lastUpdateTime = Date.now();
    return this.lastValue;
  }

  isStale(): boolean {
    return Date.now() - this.lastUpdateTime > this.staleTimeout;
  }

  getLast(): number | null {
    return this.lastValue;
  }
}

// UWB 전환 hysteresis
// GPS→UWB: 40m 이내 진입
// UWB→GPS: 55m 초과 시 (버퍼 15m)
export const UWB_ENTER_THRESHOLD = 40;
export const UWB_EXIT_THRESHOLD = 55;

const smoother = new UWBSmoother();

export function startUWB(
  sessionToken: string,
  myId: string,
  partnerId: string,
  onUpdate?: (data: { distance: number; azimuth?: number }) => void,
  onUWBUnavailable?: () => void
) {
  emitter.addListener('onUWBToken', async (data) => {
    await uploadUWBToken(sessionToken, myId, data.token, Platform.OS);
    console.log(`내 UWB 토큰 업로드 완료 (${Platform.OS})`);
  });

  subscribeUWBToken(sessionToken, partnerId, (data: any) => {
    if (Platform.OS === data.platform) {
      console.log('같은 플랫폼 → UWB 연결');
      UWBModule.connectWithToken(data.token);
    } else {
      console.log('크로스 플랫폼 → GPS 폴백');
      if (onUWBUnavailable) onUWBUnavailable();
    }
  });

  emitter.addListener('onUWBUpdate', (data) => {
    // 이동평균 스무딩
    const smoothedDistance = smoother.push(data.distance);

    // azimuth 계산 (iPhone 13 Pro 이상)
    let azimuth: number | undefined;
    if (data.directionX !== undefined && data.directionZ !== undefined) {
      azimuth = Math.atan2(data.directionX, -data.directionZ) * (180 / Math.PI);
      azimuth = (azimuth + 360) % 360;
    }

    console.log(`UWB 거리(raw): ${data.distance.toFixed(2)}m | 스무딩: ${smoothedDistance.toFixed(2)}m`);

    if (onUpdate) onUpdate({ distance: smoothedDistance, azimuth });
  });

  // UWB 세션 에러시 자동 재시작
  emitter.addListener('onUWBError', (data) => {
    console.log('UWB 에러, 재시작 시도:', data.error);
    setTimeout(() => {
      UWBModule.startSession();
    }, 1000); // 1초 후 재시작
  });

  UWBModule.startSession();
}

export function stopUWB() {
  UWBModule.stopRanging();
  emitter.removeAllListeners('onUWBUpdate');
  emitter.removeAllListeners('onUWBError');
  emitter.removeAllListeners('onUWBToken');
}
