export enum messageType {
  setVolume,
  getVolume
}

export type Message = {
  msg: messageType.getVolume
} | {
  msg: messageType.setVolume,
  volume: number
};