import * as Location from 'expo-location';
import KalmanFilter from 'kalmanjs';

// GPS 튜닝된 Kalman Filter
// R: 측정 노이즈 (클수록 스무딩 강함)
// Q: 프로세스 노이즈 (클수록 변화에 빠르게 반응)
const kfLat = new KalmanFilter({ R: 3, Q: 0.01 });
const kfLon = new KalmanFilter({ R: 3, Q: 0.01 });

interface LocationData {
  lat: number;
  lon: number;
}

export async function requestPermission(): Promise<void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('위치 권한이 필요합니다');
  }
}

export function watchLocation(onUpdate: (loc: LocationData) => void) {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 500,       // 0.5초마다 (기존 1초)
      distanceInterval: 0.5,   // 0.5m 이상 이동시 (기존 1m)
    },
    (location) => {
      const smoothedLat = kfLat.filter(location.coords.latitude);
      const smoothedLon = kfLon.filter(location.coords.longitude);
      onUpdate({ lat: smoothedLat, lon: smoothedLon });
    }
  );
}
