// services/bearing.js

// 두 좌표 사이 방위각 계산 (0~360도)
// services/bearing.js

// 방위각 계산 (근거리용 - 평면 근사)
export function getBearing(lat1, lon1, lat2, lon2) {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const angle = Math.atan2(dLon, dLat) * (180 / Math.PI);
  return (angle + 360) % 360;
}

// 거리 계산 (미터) - 근거리용 평면 근사
export function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180) * R;
  const dLon = (lon2 - lon1) * (Math.PI / 180) * R * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}
