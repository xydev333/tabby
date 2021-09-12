import { ConfigProvider, Platform } from 'terminus-core'

export class SettingsConfigProvider extends ConfigProvider {
    defaults = { }
    platformDefaults = {
        [Platform.macOS]: {
            hotkeys: {
                settings: ['⌘-,'],
            }
        },
        [Platform.Windows]: {
            hotkeys: {
                settings: ['Ctrl-,']
            }
        },
        [Platform.Linux]: {
            hotkeys: {
                settings: ['Ctrl-,']
            }
        },
    }
}
