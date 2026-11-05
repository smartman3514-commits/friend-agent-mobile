// 카메라 화면에서 찍은 사진을 대화 화면으로 넘기는 작은 연결 고리.
// 대화 화면이 받을 함수를 걸어 두고, 카메라 화면은 찍은 뒤 이 함수로 넘기고 닫힌다.
export type Photo = { uri: string; mimeType?: string | null };

let receiver: ((photo: Photo) => void) | null = null;

export function onPhoto(handler: ((photo: Photo) => void) | null) {
  receiver = handler;
}

export function deliverPhoto(photo: Photo) {
  receiver?.(photo);
}
