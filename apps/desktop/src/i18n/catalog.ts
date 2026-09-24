import { ar } from './ar'
import { en } from './en'
import { ja } from './ja'
import { ru } from './ru'
import type { Locale, Translations } from './types'

export const TRANSLATIONS: Record<Locale, Translations> = {
  en,
  ja,
  ar,
  ru
}
