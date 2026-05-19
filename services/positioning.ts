import { getDistance, getBearing } from './bearing';
import { rssiToDistance } from './ble';

interface Position {
  lat: number;
  lon: number;
}

interface RouterData {
  lat: number;
  lon: number;
  rssi: number;
  targetLat: number;
  targetLon: number;
}

// RSSI 기반 거리로 위치 추정 (라우터 1개)
function estimatePositionFromRouter(
  routerPos: Position,
  bleDistance: number,
  gpsPos: Position
): Position {
  // 라우터 중심으로 bleDistance 반경 원
  // GPS 위치와 가장 가까운 원 위의 점 계산
  const bearing = getBearing(routerPos.lat, routerPos.lon, gpsPos.lat, gpsPos.lon);
  
  // 위도/경도 1도당 미터
  const metersPerLat = 111320;
  const metersPerLon = 111320 * Math.cos(routerPos.lat * Math.PI / 180);
  
  const estimatedLat = routerPos.lat + (bleDistance * Math.cos(bearing * Math.PI / 180)) / metersPerLat;
  const estimatedLon = routerPos.lon + (bleDistance * Math.sin(bearing * Math.PI / 180)) / metersPerLon;
  
  return { lat: estimatedLat, lon: estimatedLon };
}

// 삼각측량 (라우터 2개 이상)
function triangulate(routers: { pos: Position; distance: number }[]): Position | null {
  if (routers.length < 2) return null;
  
  const metersPerLat = 111320;
  
  // 가중평균으로 위치 추정
  // 거리가 가까울수록 가중치 높음
  let totalWeight = 0;
  let weightedLat = 0;
  let weightedLon = 0;
  
  routers.forEach(({ pos, distance }) => {
    const weight = 1 / (distance * distance + 0.1); // 거리 역제곱 가중치
    weightedLat += pos.lat * weight;
    weightedLon += pos.lon * weight;
    totalWeight += weight;
  });
  
  return {
    lat: weightedLat / totalWeight,
    lon: weightedLon / totalWeight,
  };
}

// GPS + BLE 가중평균
function fusePositions(
  gpsPos: Position,
  blePos: Position | null,
  routerCount: number
): Position {
  if (!blePos || routerCount === 0) return gpsPos;
  
  // 라우터 수에 따라 BLE 가중치 증가
  const bleWeight = Math.min(0.3 * routerCount, 0.7); // 최대 0.7
  const gpsWeight = 1 - bleWeight;
  
  return {
    lat: gpsPos.lat * gpsWeight + blePos.lat * bleWeight,
    lon: gpsPos.lon * gpsWeight + blePos.lon * bleWeight,
  };
}

// 최종 거리/위치 계산 메인 함수
export function calculatePosition(params: {
  myGpsPos: Position;
  partnerGpsPos: Position | null;
  routers: RouterData[];        // 라우터들의 위치 + RSSI
  uwbDistance: number | null;   // UWB 거리 (있으면 최우선)
  uwbAzimuth: number | null;
}): {
  distance: number | null;
  bearing: number | null;
  mode: 'uwb' | 'ble+gps' | 'gps';
  confidence: number; // 0~1 신뢰도
} {
  const { myGpsPos, partnerGpsPos, routers, uwbDistance, uwbAzimuth } = params;

  // 1. UWB 최우선
  if (uwbDistance !== null && uwbDistance < 15 && uwbDistance > 0) {
    return {
      distance: uwbDistance,
      bearing: uwbAzimuth,
      mode: 'uwb',
      confidence: 0.99,
    };
  }

  if (!partnerGpsPos) return { distance: null, bearing: null, mode: 'gps', confidence: 0 };

  // 2. BLE 라우터 보정
  if (routers.length > 0) {
    // 각 라우터에서 상대방 위치 추정
    const routerEstimates = routers
      .filter(r => r.rssi > -90) // 너무 약한 신호 제외
      .map(router => {
        const bleDistance = rssiToDistance(router.rssi);
        const routerPos = { lat: router.lat, lon: router.lon };
        const estimatedPos = estimatePositionFromRouter(
          routerPos,
          bleDistance,
          partnerGpsPos
        );
        return { pos: estimatedPos, distance: bleDistance };
      });

    let blePos: Position | null = null;

    if (routerEstimates.length >= 2) {
      // 삼각측량
      blePos = triangulate(routerEstimates);
      console.log('삼각측량 적용');
    } else if (routerEstimates.length === 1) {
      blePos = routerEstimates[0].pos;
      console.log('단일 라우터 보정');
    }

    // GPS + BLE 융합
    const fusedPartnerPos = fusePositions(partnerGpsPos, blePos, routers.length);
    const distance = getDistance(myGpsPos.lat, myGpsPos.lon, fusedPartnerPos.lat, fusedPartnerPos.lon);
    const bearing = getBearing(myGpsPos.lat, myGpsPos.lon, fusedPartnerPos.lat, fusedPartnerPos.lon);
    const confidence = Math.min(0.5 + routers.length * 0.15, 0.85);

    return { distance, bearing, mode: 'ble+gps', confidence };
  }

  // 3. GPS만
  const distance = getDistance(myGpsPos.lat, myGpsPos.lon, partnerGpsPos.lat, partnerGpsPos.lon);
  const bearing = getBearing(myGpsPos.lat, myGpsPos.lon, partnerGpsPos.lat, partnerGpsPos.lon);

  return { distance, bearing, mode: 'gps', confidence: 0.4 };
}
