import { sha256Hex } from './sha256'

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin)
export const hashPin = (pin: string) => sha256Hex(`guaibao-quest:${pin}`)
export const checkPin = (pin: string, hash: string) => isValidPin(pin) && hashPin(pin) === hash
