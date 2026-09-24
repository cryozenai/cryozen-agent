import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fieldCopyForSchemaKey } from '@/app/settings/field-copy'

import { TRANSLATIONS } from './catalog'
import { ja } from './ja'
import { setRuntimeI18nLocale, translateNow } from './runtime'

describe('desktop i18n runtime translator', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('en')
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('translates string paths for the active runtime locale', () => {
    setRuntimeI18nLocale('ja')

    expect(translateNow('boot.ready')).toBe('Cryozen Desktop の準備ができました')
    expect(translateNow('notifications.voice.noSpeechDetected')).toBe('音声が検出されませんでした')
    expect(translateNow('composer.lookupNoMatches')).toBe('一致なし。')
    expect(translateNow('assistant.tool.statusRecovered')).toBe('回復しました')
  })

  it('passes arguments to function translations', () => {
    expect(translateNow('notifications.updateReadyMessage', 2)).toBe('2 new changes available.')
  })

  it('translates migrated overlap keys for newly supported locales', () => {
    setRuntimeI18nLocale('ja')
    expect(translateNow('common.save')).toBe('保存')
    expect(translateNow('cron.promptPlaceholder')).toBe('実行ごとにエージェントが行う内容は？')
  })

  it('translates settings copy for newly supported locales', () => {
    setRuntimeI18nLocale('ja')
    expect(translateNow('settings.appearance.title')).toBe('外観')
    expect(translateNow('settings.nav.providers')).toBe('プロバイダー')
    expect(translateNow('settings.nav.providerApiKeys')).toBe('API キー')

    setRuntimeI18nLocale('ar')
    expect(translateNow('settings.appearance.reasoningCollapsedTitle')).toBe('طي التفكير افتراضيًا')
    expect(translateNow('settings.appearance.reasoningCollapsedDesc')).toBe(
      'أبقِ التفكير المتدفق متاحًا دون توسيعه حتى تفتحه.'
    )
  })

  it('translates Russian model and Bot Mode labels', () => {
    setRuntimeI18nLocale('ru')

    expect(translateNow('settings.model.moaTitle')).toBe('Смесь агентов')
    expect(translateNow('common.bots')).toBe('Боты')
  })

  it('keeps translated settings field copy addressable from schema keys', () => {
    const field = ['display', 'show_reasoning'].join('.')

    expect(fieldCopyForSchemaKey(ja.settings.fieldLabels, field)).toBe('推論ブロック')
    expect(fieldCopyForSchemaKey(ja.settings.fieldDescriptions, field)).toBe(
      'バックエンドが推論内容を提供したときに表示します。'
    )
  })

  it('falls back to English when the active locale cannot resolve a key', () => {
    const boot = TRANSLATIONS.ja.boot as { ready?: string }
    const originalReady = boot.ready

    try {
      boot.ready = undefined
      setRuntimeI18nLocale('ja')

      expect(translateNow('boot.ready')).toBe('Cryozen Desktop is ready')
    } finally {
      boot.ready = originalReady
    }
  })

  it('returns the key when no locale can resolve a path', () => {
    setRuntimeI18nLocale('ja')

    expect(translateNow('missing.path')).toBe('missing.path')
  })
})
