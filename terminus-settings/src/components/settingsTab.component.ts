/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as yaml from 'js-yaml'
import { debounce } from 'utils-decorators/dist/cjs'
import { Subscription } from 'rxjs'
import { Component, Inject, Input, HostBinding, NgZone } from '@angular/core'
import {
    ElectronService,
    DockingService,
    ConfigService,
    HotkeyDescription,
    HotkeysService,
    BaseTabComponent,
    Theme,
    HostAppService,
    Platform,
    HomeBaseService,
    ShellIntegrationService,
    isWindowsBuild,
    WIN_BUILD_FLUENT_BG_SUPPORTED,
} from 'terminus-core'

import { SettingsTabProvider } from '../api'

/** @hidden */
@Component({
    selector: 'settings-tab',
    template: require('./settingsTab.component.pug'),
    styles: [
        require('./settingsTab.component.scss'),
        require('./settingsTab.deep.component.css'),
    ],
})
export class SettingsTabComponent extends BaseTabComponent {
    @Input() activeTab: string
    hotkeyFilter = ''
    hotkeyDescriptions: HotkeyDescription[]
    screens: any[]
    Platform = Platform
    configDefaults: any
    configFile: string
    isShellIntegrationInstalled = false
    isFluentVibrancySupported = false
    @HostBinding('class.pad-window-controls') padWindowControls = false
    private configSubscription: Subscription

    constructor (
        public config: ConfigService,
        private electron: ElectronService,
        public docking: DockingService,
        public hostApp: HostAppService,
        public homeBase: HomeBaseService,
        public shellIntegration: ShellIntegrationService,
        public zone: NgZone,
        hotkeys: HotkeysService,
        @Inject(SettingsTabProvider) public settingsProviders: SettingsTabProvider[],
        @Inject(Theme) public themes: Theme[],
    ) {
        super()
        this.setTitle('Settings')
        this.screens = this.docking.getScreens()
        this.settingsProviders = config.enabledServices(this.settingsProviders)
        this.themes = config.enabledServices(this.themes)

        this.configDefaults = yaml.dump(config.getDefaults())

        const onConfigChange = () => {
            this.configFile = config.readRaw()
            this.padWindowControls = hostApp.platform === Platform.macOS
                && config.store.appearance.tabsLocation !== 'top'
        }

        this.configSubscription = config.changed$.subscribe(onConfigChange)
        onConfigChange()

        hostApp.displaysChanged$.subscribe(() => {
            this.zone.run(() => this.screens = this.docking.getScreens())
        })

        hotkeys.getHotkeyDescriptions().then(descriptions => {
            this.hotkeyDescriptions = descriptions
        })

        this.isFluentVibrancySupported = isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)
    }

    async ngOnInit () {
        this.isShellIntegrationInstalled = await this.shellIntegration.isInstalled()
    }

    async toggleShellIntegration () {
        if (!this.isShellIntegrationInstalled) {
            await this.shellIntegration.install()
        } else {
            await this.shellIntegration.remove()
        }
        this.isShellIntegrationInstalled = await this.shellIntegration.isInstalled()
    }

    ngOnDestroy () {
        this.configSubscription.unsubscribe()
        this.config.save()
    }

    restartApp () {
        this.hostApp.relaunch()
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }

    saveConfigFile () {
        if (this.isConfigFileValid()) {
            this.config.writeRaw(this.configFile)
        }
    }

    showConfigFile () {
        this.electron.shell.showItemInFolder(this.config.path)
    }

    isConfigFileValid () {
        try {
            yaml.load(this.configFile)
            return true
        } catch (_) {
            return false
        }
    }

    getHotkey (id: string) {
        let ptr = this.config.store.hotkeys
        for (const token of id.split(/\./g)) {
            ptr = ptr[token]
        }
        return ptr
    }

    setHotkey (id: string, value) {
        let ptr = this.config.store
        let prop = 'hotkeys'
        for (const token of id.split(/\./g)) {
            ptr = ptr[prop]
            prop = token
        }
        ptr[prop] = value
    }

    hotkeyFilterFn (hotkey: HotkeyDescription, query: string): boolean {
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        const s = hotkey.name + (this.getHotkey(hotkey.id) || []).toString()
        return s.toLowerCase().includes(query.toLowerCase())
    }
}
