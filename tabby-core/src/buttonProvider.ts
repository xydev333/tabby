/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Injectable } from '@angular/core'

import { ToolbarButton, ToolbarButtonProvider } from './api/toolbarButtonProvider'
import { SelectorService } from './services/selector.service'
import { HostAppService, Platform } from './api/hostApp'
import { Profile } from './api/profileProvider'
import { ConfigService } from './services/config.service'
import { SelectorOption } from './api/selector'
import { HotkeysService } from './services/hotkeys.service'
import { ProfilesService } from './services/profiles.service'
import { AppService } from './services/app.service'
import { NotificationsService } from './services/notifications.service'

/** @hidden */
@Injectable()
export class ButtonProvider extends ToolbarButtonProvider {
    constructor (
        private selector: SelectorService,
        private app: AppService,
        private hostApp: HostAppService,
        private profilesServices: ProfilesService,
        private config: ConfigService,
        private notifications: NotificationsService,
        hotkeys: HotkeysService,
    ) {
        super()
        hotkeys.hotkey$.subscribe(hotkey => {
            if (hotkey === 'profile-selector') {
                this.activate()
            }
        })
    }

    async activate () {
        const recentProfiles: Profile[] = this.config.store.recentProfiles

        let options: SelectorOption<void>[] = recentProfiles.map(p => ({
            ...this.profilesServices.selectorOptionForProfile(p),
            icon: 'fas fa-history',
            callback: async () => {
                if (p.id) {
                    p = (await this.profilesServices.getProfiles()).find(x => x.id === p.id) ?? p
                }
                this.launchProfile(p)
            },
        }))
        if (recentProfiles.length) {
            options.push({
                name: 'Clear recent connections',
                icon: 'fas fa-eraser',
                callback: async () => {
                    this.config.store.recentProfiles = []
                    this.config.save()
                },
            })
        }

        let profiles = await this.profilesServices.getProfiles()

        if (!this.config.store.terminal.showBuiltinProfiles) {
            profiles = profiles.filter(x => !x.isBuiltin)
        }

        profiles = profiles.filter(x => !x.isTemplate)

        options = [...options, ...profiles.map((p): SelectorOption<void> => ({
            ...this.profilesServices.selectorOptionForProfile(p),
            callback: () => this.launchProfile(p),
        }))]

        try {
            const { SettingsTabComponent } = window['nodeRequire']('tabby-settings')
            options.push({
                name: 'Manage profiles',
                icon: 'fas fa-window-restore',
                callback: () => this.app.openNewTabRaw({
                    type: SettingsTabComponent,
                    inputs: { activeTab: 'profiles' },
                }),
            })
        } catch { }

        if (this.profilesServices.getProviders().some(x => x.supportsQuickConnect)) {
            options.push({
                name: 'Quick connect',
                freeInputPattern: 'Connect to "%s"...',
                icon: 'fas fa-arrow-right',
                callback: query => this.quickConnect(query),
            })
        }
        await this.selector.show('Select profile', options)
    }

    quickConnect (query: string) {
        for (const provider of this.profilesServices.getProviders()) {
            if (provider.supportsQuickConnect) {
                const profile = provider.quickConnect(query)
                if (profile) {
                    this.launchProfile(profile)
                    return
                }
            }
        }
        this.notifications.error(`Could not parse "${query}"`)
    }

    async launchProfile (profile: Profile) {
        await this.profilesServices.openNewTabForProfile(profile)

        let recentProfiles = this.config.store.recentProfiles
        recentProfiles = recentProfiles.filter(x => x.group !== profile.group || x.name !== profile.name)
        recentProfiles.unshift(profile)
        if (recentProfiles.length > 5) {
            recentProfiles.pop()
        }
        this.config.store.recentProfiles = recentProfiles
        this.config.save()
    }

    provide (): ToolbarButton[] {
        return [{
            icon: this.hostApp.platform === Platform.Web
                ? require('./icons/plus.svg')
                : require('./icons/profiles.svg'),
            title: 'New tab with profile',
            click: () => this.activate(),
        }]
    }
}
