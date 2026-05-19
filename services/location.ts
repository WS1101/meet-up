// services/location.ts
import * as Location from 'expo-location';
import KalmanFilter from 'kalmanjs';

const kfLat = new KalmanFilter();
const kfLon = new KalmanFilter();

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
      accuracy: Location.Accuracy.High,
      timeInterval: 1000,
      distanceInterval: 1,
    },
    (location) => {
      const smoothedLat = kfLat.filter(location.coords.latitude);
      const smoothedLon = kfLon.filter(location.coords.longitude);
      onUpdate({ lat: smoothedLat, lon: smoothedLon });
    }
  );
}