declare module 'utif' {
  interface IFD {
    width: number
    height: number
    [k: string]: any
  }
  const UTIF: {
    encodeImage(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, metadata?: any): ArrayBuffer
    decode(buff: ArrayBuffer | Uint8Array): IFD[]
    decodeImage(buff: ArrayBuffer | Uint8Array, ifd: IFD, all?: IFD[]): void
    toRGBA8(ifd: IFD): Uint8Array
  }
  export default UTIF
}
