/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { debounce } from 'utils-decorators/dist/cjs'
import { Component, Inject, NgZone, Optional } from '@angular/core'
import {
    DockingService,
    ConfigService,
    Theme,
    HostAppService,
    Platform,
    isWindowsBuild,
    WIN_BUILD_FLUENT_BG_SUPPORTED,
    BaseComponent,
    Screen,
    PlatformService,
} from 'terminus-core'


/** @hidden */
@Component({
    selector: 'window-settings-tab',
    template: require('./windowSettingsTab.component.pug'),
})
export class WindowSettingsTabComponent extends BaseComponent {
    screens: Screen[]
    Platform = Platform
    isFluentVibrancySupported = false

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        public platform: PlatformService,
        public zone: NgZone,
        @Inject(Theme) public themes: Theme[],
        @Optional() public docking?: DockingService,
    ) {
        super()

        this.themes = config.enabledServices(this.themes)

        if (this.docking) {
            this.subscribeUntilDestroyed(hostApp.displaysChanged$, () => {
                this.zone.run(() => this.screens = this.docking!.getScreens())
            })
            this.screens = this.docking.getScreens()
        }

        this.isFluentVibrancySupported = isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }
}
