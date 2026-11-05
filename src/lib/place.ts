// 지금 있는 곳을 백엔드가 지원하는 도시 이름으로 바꾼다(날씨·미세먼지 지역 맞추기).
// 개인정보: 좌표는 폰 안에서만 쓰고 서버에는 보내지 않는다. 서버로 가는 것은 '서울' 같은 도시 이름 하나뿐이다.
import * as Location from 'expo-location';

export class LocationDenied extends Error {
  constructor(public canAskAgain: boolean) {
    super(canAskAgain ? '위치 권한을 허락해야 지역을 맞출 수 있어요.' : '위치 권한이 꺼져 있어요. 휴대폰 설정에서 켜 주세요.');
  }
}

export async function cityFromGps(cities: string[]): Promise<{ city: string | null; area: string }> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new LocationDenied(permission.canAskAgain);
  // 도시만 알면 되므로 정확도는 낮게(배터리·시간 절약)
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
  const [address] = await Location.reverseGeocodeAsync({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  });
  const parts = [address?.city, address?.subregion, address?.district, address?.region].filter(
    (p): p is string => !!p,
  );
  // '성남시' → 성남, '서울특별시' → 서울. 지원하지 않는 곳이면 null
  const city = cities.find((c) => parts.some((p) => p.includes(c))) ?? null;
  return { city, area: parts[0] ?? '알 수 없는 곳' };
}
